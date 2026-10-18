#!/bin/sh
# Run as root from the extracted package. Keeps the data in /var/lib/decibel.
#
# Trust boundary: everything this script runs as root, and everything the service executes (Node, the
# Python/yt-dlp runtime and the application), lives in root-owned trees outside the service's writable
# state. The `decibel` user can read and run them but cannot modify them. Backups go to a root-only
# directory. Nothing under /var/lib/decibel is ever executed or followed as root.
set -eu
umask 022
cd "$(dirname "$0")/.."

state=/var/lib/decibel
runtime_root=/opt/decibel-runtime
backup_root=/var/backups/decibel

fail() { echo "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "Run the installer as root."
exec 9>/var/lock/decibel-install.lock
flock -n 9 || fail "Another Decibel installation is already running."
[ "$(uname -m)" = x86_64 ] || fail "This package requires Linux x86_64."
command -v setpriv >/dev/null || fail "setpriv (util-linux) is required."
df -h /
[ "$(df -Pk / | awk 'NR==2 {print $4}')" -ge 524288 ] || fail "At least 512 MiB of free space is required."
sha256sum --quiet -c SHA256SUMS

# True if the path and every parent up to / are real directories owned by root and not writable by
# group or others, i.e. only root could have created or replaced anything along the way.
root_owned_chain() {
  p=$1
  while :; do
    { [ -d "$p" ] && [ ! -L "$p" ]; } || return 1
    [ "$(stat -c %u "$p")" = 0 ] || return 1
    case $(stat -c %A "$p") in ?????w*|????????w*) return 1 ;; esac
    [ "$p" = / ] && return 0
    p=$(dirname "$p")
  done
}

# A tree root may execute: root-owned parent chain and nothing inside owned by another user or writable
# by group/others (symbolic links are skipped for the mode test; only root can create them here).
tree_is_safe() {
  root_owned_chain "$1" || return 1
  [ -z "$(find "$1" -xdev \( ! -user 0 -o ! -group 0 -o \( ! -type l -perm /022 \) \) -print -quit)" ]
}

# An existing runtime is reused only if it is a safe tree with its completion marker.
runtime_is_safe() {
  [ -f "$1/.ready" ] && [ ! -L "$1/.ready" ] || return 1
  tree_is_safe "$1"
}

# Creates a root-only or root-owned directory; refuses symbolic links and unsafe existing ownership.
root_dir() {
  [ -L "$1" ] && fail "$1 is a symbolic link; refusing to continue."
  install -d -o root -g root -m "$2" "$1"
  root_owned_chain "$1" || fail "$1 (or one of its parents) is not root-owned or is writable by others."
}

# Service-owned state: created if missing, never followed or re-owned when it already exists.
state_dir() {
  [ -L "$1" ] && fail "$1 is a symbolic link; refusing to continue."
  if [ ! -e "$1" ]; then mkdir -m 750 "$1" && chown -h decibel:decibel "$1"; fi
  [ -d "$1" ] || fail "$1 is not a directory."
}

# Tool checks run as the unprivileged service user, not as root.
as_service() {
  setpriv --reuid=decibel --regid=decibel --init-groups --reset-env -- \
    env HOME="$state" XDG_CACHE_HOME="$state/cache" PYTHONDONTWRITEBYTECODE=1 "$@"
}

node_archive=node-v22.23.3-linux-x64.tar.xz
node_dir=/opt/node-v22.23.3-linux-x64
if [ ! -x "$node_dir/bin/node" ] || ! tree_is_safe "$node_dir"; then
  # Older installers kept the archive's owner (not root); extract again as root-owned, read-only for others.
  rm -rf -- "$node_dir"
  tar -xJf "$node_archive" --no-same-owner --no-same-permissions -C /opt
  chown -R -h root:root "$node_dir"
  chmod -R go-w "$node_dir"
fi
tree_is_safe "$node_dir" || fail "$node_dir is not root-owned or is writable by others."
"$node_dir/bin/node" --version
ln -sfn "$node_dir/bin/node" /usr/local/bin/node
ln -sfn "$node_dir/bin/npm" /usr/local/bin/npm

# The bundled wheels target Python 3.13 (Debian 13).
if ! python3 -c 'import sys; assert sys.version_info[:2] == (3, 13); import venv, ensurepip' 2>/dev/null; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 python3-venv ca-certificates
fi
python3 -c 'import sys; assert sys.version_info[:2] == (3, 13), "This package requires Python 3.13"; import venv, ensurepip'
id decibel >/dev/null 2>&1 || useradd --system --home-dir "$state" --no-create-home --shell /usr/sbin/nologin decibel
for dir in "$state" "$state/music" "$state/cache" "$state/cache/yt-dlp"; do state_dir "$dir"; done

# Public release files (APK, desktop installers, update manifests): root writes them, the service only reads.
root_dir /srv/decibel-releases 755

# Python runtime (ytmusicapi + yt-dlp) in the root-owned tree.
root_dir "$runtime_root" 755
runtime_id=$(sha256sum runtime/requirements.lock | cut -c1-16)
python_env=$runtime_root/ytmusic-$runtime_id
if ! runtime_is_safe "$python_env"; then
  if [ -e "$python_env" ] || [ -L "$python_env" ]; then
    echo "Existing runtime $python_env is incomplete or not safe to reuse; recreating it." >&2
    rm -rf -- "$python_env"
  fi
  python3 -m venv "$python_env"
  "$python_env/bin/python" -m pip install --disable-pip-version-check --no-cache-dir --no-index --find-links=runtime/wheels --require-hashes -r runtime/requirements.lock
  "$python_env/bin/python" -m pip check
  "$python_env/bin/python" -c 'import yt_dlp, yt_dlp_ejs, ytmusicapi'
  chown -R -h root:root "$python_env"
  chmod -R go-w "$python_env"
  touch "$python_env/.ready"
fi
runtime_is_safe "$python_env" || fail "The runtime in $python_env failed the ownership/permission check."

stamp=$(date -u +%Y%m%dT%H%M%S)-$$
root_dir "$backup_root" 700
backup=$backup_root/$stamp
install -d -m 700 "$backup"
if [ -f "$state/decibel.db" ]; then
  python3 - "$state/decibel.db" "$backup/decibel.db" <<'PY'
import sqlite3, sys
with sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True) as source:
    with sqlite3.connect(sys.argv[2]) as target:
        source.backup(target)
PY
fi
cp -a "$state/music" "$backup/music"
if [ -f /etc/systemd/system/decibel.service ]; then cp -a /etc/systemd/system/decibel.service "$backup/decibel.service"; fi
previous_app=/opt/decibel.previous-$stamp
staged_app=/opt/decibel.staged-$stamp
cp -a app "$staged_app"
chown -R root:root "$staged_app"
chmod -R a-w,a+rX "$staged_app"

# The service user must be able to run the tools it will use, without being able to change them.
as_service "$python_env/bin/yt-dlp" --version
as_service "$python_env/bin/python" -B "$staged_app/server/ytmusic.py" health ""

previous_runtime=$(readlink "$runtime_root/ytmusic" 2>/dev/null || true)
activated=0
stopped=0
rollback() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ "$result" -ne 0 ] && [ "$activated" = 1 ]; then
    echo "Health check failed; restoring the previous version." >&2
    systemctl stop decibel.service || true
    if [ -d /opt/decibel ]; then mv /opt/decibel "/opt/decibel.failed-$stamp"; fi
    if [ -d "$previous_app" ]; then mv "$previous_app" /opt/decibel; fi
    if [ -n "$previous_runtime" ]; then ln -sfn "$previous_runtime" "$runtime_root/ytmusic"; else rm -f "$runtime_root/ytmusic"; fi
    if [ -f "$backup/decibel.service" ]; then
      cp -a "$backup/decibel.service" /etc/systemd/system/decibel.service
      systemctl daemon-reload
      systemctl restart decibel.service || true
    fi
    echo "Data backup kept in $backup; live data was not replaced." >&2
  elif [ "$result" -ne 0 ] && [ "$stopped" = 1 ]; then
    systemctl start decibel.service || true
  fi
  exit "$result"
}
trap rollback EXIT
trap 'exit 1' HUP INT TERM
if systemctl cat decibel.service >/dev/null 2>&1; then systemctl stop decibel.service; fi
stopped=1
if [ -d /opt/decibel ]; then mv /opt/decibel "$previous_app"; fi
activated=1
mv "$staged_app" /opt/decibel
ln -sfn "$(basename "$python_env")" "$runtime_root/ytmusic"
install -m 644 deploy/decibel.service /etc/systemd/system/decibel.service
systemctl daemon-reload
systemctl enable decibel.service
systemctl restart decibel.service
/usr/local/bin/node deploy/check-health.mjs
activated=0

# Migration from installers that kept the runtime in the service's state directory (writable by the
# service user). It is no longer used once the new unit is healthy; never executed or followed as root.
if [ -e "$state/tools" ] || [ -L "$state/tools" ]; then
  rm -rf -- "$state/tools"
  echo "Removed the legacy runtime directory $state/tools (now in $runtime_root)."
fi
echo "Installation verified. Previous version: $previous_app. Data backup: $backup."
df -h /
