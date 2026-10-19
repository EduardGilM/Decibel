# Changelog

All notable changes to Decibel. Versions follow the app version in `src-tauri/tauri.conf.json`.

## 0.1.20

Covers 0.1.13 to 0.1.20.

### Added
- **Playback devices**: choose where the music plays among the devices open with the same profile; song,
  position and queue move along and the other devices act as remotes. See [docs/devices.md](docs/devices.md).
- **Library sync across devices**: likes and playlists refresh automatically when another device or an import
  changes them (`/api/me/revision`).
- **Import from Spotify**: a public playlist by link (Tu biblioteca → «Importar lista por enlace»), or the whole
  library from an Exportify ZIP or Spotify's data download, or with an optional Spotify app on the server (OAuth
  PKCE). Imports run in the background with a small progress notice. See
  [docs/spotify-import.md](docs/spotify-import.md).
- **Android Auto**: browse the queue, likes and playlists, playback controls and voice search.
- The native apps notice a new release while they stay open, not only at start-up.

### Changed
- Linux desktop builds are published as `.deb` only; AppImage is no longer built and `/download` offers the `.deb`.
- Lyrics prefer synced matches, are cached on the device and are refreshed when stale (unsynced after ten
  minutes, synced and instrumental after six hours).
- With no device selected, a playback control makes the current device take over.

### Fixed
- Playback that stopped for good when the audio stream was throttled: the watchdog now requires real progress, so
  a stream that only trickles in is retried with a fresh URL from the same position, then skipped.
- Pressing Enter right after typing a search no longer fails with «varias consultas en curso»: aborted lookups free
  their slot and searches wait in a bounded queue.
- Recent searches saved by 0.1.9 are kept and reach the profile.
- The «A continuación» card is back under the lyrics preview on desktop; rounded corners on the lyrics cards.
- The real yt-dlp extraction test only runs with `DECIBEL_REAL_YTDLP=1`.

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
