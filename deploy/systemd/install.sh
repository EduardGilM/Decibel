#!/bin/sh
# Run as root from the extracted package. Keeps /var/lib/decibel.
set -eu
cd "$(dirname "$0")/.."
[ "$(id -u)" = 0 ] || { echo "Run the installer as root." >&2; exit 1; }
exec 9>/var/lock/decibel-install.lock
flock -n 9 || { echo "Another Decibel installation is already running." >&2; exit 1; }
[ "$(uname -m)" = x86_64 ] || { echo "This package requires Linux x86_64." >&2; exit 1; }
df -h /
[ "$(df -Pk / | awk 'NR==2 {print $4}')" -ge 524288 ] || { echo "At least 512 MiB of free space is required." >&2; exit 1; }
sha256sum --quiet -c SHA256SUMS

node_archive=node-v22.23.3-linux-x64.tar.xz
node_dir=/opt/node-v22.23.3-linux-x64
if [ ! -x "$node_dir/bin/node" ]; then tar -xJf "$node_archive" -C /opt; fi
"$node_dir/bin/node" --version
ln -sfn "$node_dir/bin/node" /usr/local/bin/node
ln -sfn "$node_dir/bin/npm" /usr/local/bin/npm

# The bundled wheels target Python 3.13 (Debian 13).
if ! python3 -c 'import sys; assert sys.version_info[:2] == (3, 13); import venv, ensurepip' 2>/dev/null; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 python3-venv ca-certificates
fi
python3 -c 'import sys; assert sys.version_info[:2] == (3, 13), "This package requires Python 3.13"; import venv, ensurepip'
id decibel >/dev/null 2>&1 || useradd --system --home-dir /var/lib/decibel --no-create-home --shell /usr/sbin/nologin decibel
install -d -o decibel -g decibel -m 750 /var/lib/decibel /var/lib/decibel/music /var/lib/decibel/cache /var/lib/decibel/cache/yt-dlp
install -d -m 755 /var/lib/decibel/tools
runtime_id=$(sha256sum runtime/requirements.lock | cut -c1-16)
python_env=/var/lib/decibel/tools/ytmusic-$runtime_id
if [ ! -f "$python_env/.ready" ]; then
  python3 -m venv "$python_env"
  "$python_env/bin/python" -m pip install --disable-pip-version-check --no-cache-dir --no-index --find-links=runtime/wheels --require-hashes -r runtime/requirements.lock
  "$python_env/bin/python" -m pip check
  "$python_env/bin/python" -c 'import yt_dlp, yt_dlp_ejs, ytmusicapi'
  touch "$python_env/.ready"
fi
"$python_env/bin/yt-dlp" --version
"$python_env/bin/python" -B app/server/ytmusic.py health ""

stamp=$(date -u +%Y%m%dT%H%M%S)-$$
backup=/var/lib/decibel/backups/$stamp
install -d -m 700 "$backup"
if [ -f /var/lib/decibel/decibel.db ]; then
  python3 - "$backup/decibel.db" <<'PY'
import sqlite3, sys
with sqlite3.connect('file:/var/lib/decibel/decibel.db?mode=ro', uri=True) as source:
    with sqlite3.connect(sys.argv[1]) as target:
        source.backup(target)
PY
fi
cp -a /var/lib/decibel/music "$backup/music"
if [ -f /etc/systemd/system/decibel.service ]; then cp -a /etc/systemd/system/decibel.service "$backup/decibel.service"; fi
previous_app=/opt/decibel.previous-$stamp
staged_app=/opt/decibel.staged-$stamp
cp -a app "$staged_app"
chown -R root:root "$staged_app"
chmod -R a-w,a+rX "$staged_app"
previous_runtime=$(readlink /var/lib/decibel/tools/ytmusic || true)
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
    if [ -n "$previous_runtime" ]; then ln -sfn "$previous_runtime" /var/lib/decibel/tools/ytmusic; else rm -f /var/lib/decibel/tools/ytmusic; fi
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
ln -sfn "$(basename "$python_env")" /var/lib/decibel/tools/ytmusic
install -m 644 deploy/decibel.service /etc/systemd/system/decibel.service
systemctl daemon-reload
systemctl enable decibel.service
systemctl restart decibel.service
/usr/local/bin/node deploy/check-health.mjs
activated=0
echo "Installation verified. Previous version: $previous_app. Data backup: $backup."
df -h /
