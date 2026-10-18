# Changelog

All notable changes to Decibel. Versions follow the app version in `src-tauri/tauri.conf.json`.

## 0.1.12

### Added
- **Desktop apps** for Windows (NSIS installer) and Linux (AppImage and .deb), built with Tauri v2, with an
  integrated title bar and window controls instead of the native one.
- **Windows taskbar controls**: previous, play/pause, next and mute thumbnail buttons, plus system media controls.
- **In-app updates**: an «Actualización disponible» dialog whose «Actualizar» button updates in place with a
  progress bar. Desktop uses the signed Tauri updater and relaunches; Android downloads the APK in the app, checks
  its sha256 and opens the system installer, asking for «install unknown apps» when needed. A download button
  next to the avatar on desktop opens the same dialog.
- **Download page** (`/download`) and release files served from `DECIBEL_RELEASES_DIR` (`/releases/*`,
  `/api/app/version`, `SHA256SUMS.txt`), with hash-versioned URLs. `scripts/release.mjs` publishes a release
  and verifies the updater signatures before uploading. See [docs/releases.md](docs/releases.md).
- **Desktop queue gestures**: swipe right to add a song to the queue and left to remove it with the mouse or
  touchpad, plus «Añadir/Quitar de la cola» in the «…» menu and on right-click.
- **«A continuación»** card in the desktop side panel (only when a song comes next), with a «Ver cola» pill and
  drag handles on hover.
- **Mini player swipe** to skip to the next or previous song.
- **Recent searches synced** per profile across devices (`/api/me/searches`, local cache, offline queue and a
  one-time migration of existing local searches).
- **Playback watchdog**: a song stuck loading is retried twice and then skipped; radio waits are bounded.

### Changed
- **Lyrics preview header** is translucent with a strong blur over its own blurred copy of the lyrics, with eased
  fades, on mobile and desktop, so lines are no longer cut off.
- **Dynamic theme** derives the accent from a dominant colour of the current artwork, keeping contrast; black and
  white covers keep a grey accent.
- Avatar menu shows only the profile name, with the player's glass style.
- New app icons: transparent background, adaptive Android icon with a monochrome layer.

### Fixed
- The Geist font is applied to the body (some WebViews showed a serif fallback).
- Square close button when the desktop window is maximized.

## 0.1.8

First public release.
