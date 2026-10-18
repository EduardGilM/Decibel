# Releases, downloads and in-app updates

Decibel can publish its own installers from your server, without GitHub releases or any paid service.
Everything is configured with environment variables: no URL or key is built into the code.

## What the server serves

When `DECIBEL_RELEASES_DIR` points to a directory (for example `/srv/decibel-releases`, outside git and owned
by root), the server publishes, without login:

| Route | Content |
| --- | --- |
| `/download` | Minimal download page: detects the platform and offers the APK, Windows and Linux builds |
| `/releases/<file>` | The installers, `SHA256SUMS.txt` and the manifests (`releases.json`, `latest.json`) |
| `/api/app/version` | Latest published version (`version`, `versionCode`, `notes` and, per platform, file name, sha256 and size) |

Only regular files with safe names inside that directory are served. Without the variable these routes do not
exist. The systemd unit mounts the directory read-only (`ReadOnlyPaths`), so the service cannot modify it.

## In-app updates

The native apps check for updates on start-up, every few hours and when they come back to the foreground. A
«Actualización disponible» dialog offers «Más tarde» (silences that version for the day) and «Actualizar»,
which updates in place with a progress bar. `/download` is only offered as a fallback after an error.

- **Desktop (Windows/Linux):** Tauri updater plugin.
  - Fetches `<update URL>/releases/latest.json` and verifies the minisign signature with the public key built
    into the app; anything else is rejected.
  - Installs the update and relaunches the app. A download button next to the avatar opens the same dialog.
- **Android:** the app reads `<update URL>/api/app/version`.
  - Downloads the APK inside the app, checks its sha256 and opens the system package installer
    (`REQUEST_INSTALL_PACKAGES` + FileProvider).
  - If Decibel is not allowed to «install unknown apps» yet, it opens that Settings screen and continues when
    you come back, without downloading again.
  - Android only accepts the update if it is signed with the same keystore and application id.

The update URL is taken at build time from `NEXT_PUBLIC_UPDATE_URL` or, if empty, `NEXT_PUBLIC_DECIBEL_SERVER`.

**Keep stable**, or installed apps stop updating: the Android keystore and application id, the updater key pair,
and the format and paths of `latest.json`, `releases.json` and `/api/app/version`.

## Building the desktop apps

```bash
# Linux AppImage + .deb and Windows NSIS (cross-compiled with cargo-xwin)
DECIBEL_SERVER=https://music.example.com \
DECIBEL_UPDATER_PUBKEY=/path/to/updater.key.pub \
node scripts/build-desktop.mjs [--linux] [--windows] [--skip-web]
```

- `DECIBEL_SERVER` is the server the app uses; `DECIBEL_UPDATE_URL` optionally points updates elsewhere.
  `DECIBEL_UPDATER_PUBKEY` is the updater **public** key. Both are injected with `--config` into the git-ignored
  `src-tauri/tauri.desktop.json`; without a key the app is built without self-update.
- Windows is built from Linux with `cargo install cargo-xwin`, `rustup target add x86_64-pc-windows-msvc`, plus
  `nsis`, `lld` and `llvm`. The installer has no Authenticode signature, so SmartScreen shows a warning.
- The AppImage bundles GStreamer; the `.deb` depends on the system `gstreamer1.0-plugins-*` packages.
- On Windows the app adds taskbar thumbnail buttons (previous, play/pause, next, mute) and system media controls.

Updater key pair (once), stored outside the repository:

```bash
mkdir -p ~/.decibel-keys && chmod 700 ~/.decibel-keys
openssl rand -base64 32 > ~/.decibel-keys/updater.key.password
npx tauri signer generate --ci -w ~/.decibel-keys/updater.key -p "$(cat ~/.decibel-keys/updater.key.password)"
```

If you lose this key, installed desktop apps can no longer update themselves and must be reinstalled by hand.

## Publishing

```bash
DECIBEL_PUBLIC_URL=https://music.example.com \
DECIBEL_RELEASE_TARGET=myserver:/srv/decibel-releases \
node scripts/release.mjs --version 1.2.3 \
  --apk Decibel.apk --windows Decibel_1.2.3_x64-setup.exe \
  --appimage Decibel_1.2.3_amd64.AppImage --deb Decibel_1.2.3_amd64.deb \
  --notes "What's new" --publish
```

The script:

1. Copies the files under canonical names.
2. Signs the desktop installers (`DECIBEL_UPDATER_KEY`, default `~/.decibel-keys/updater.key`, with its
   `.password` file) and **verifies every signature** against the public key (`DECIBEL_UPDATER_PUBKEY`, default
   `<key>.pub`) with `scripts/updater-signature.mjs`, the same check the apps make.
3. Writes `releases.json`, the signed `latest.json` and `SHA256SUMS.txt`. URLs carry `?v=<hash>` so a CDN in
   front of the server never serves an older build.
4. Uploads the installers first and then the manifests, renamed into place atomically.
5. Downloads every served file to check its sha256, and checks `/api/app/version`.

Without `--publish` it only stages everything (default `~/decibel-build/release-<version>`, or `--out`).
