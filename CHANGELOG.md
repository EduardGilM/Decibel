# Changelog

All notable changes to Decibel. Versions follow the app version in `src-tauri/tauri.conf.json`.

## 0.1.36

Covers 0.1.26 to 0.1.36. Source preparation; no new app installers are published by this change.

### Added
- Optional device-local music downloads, storage limits, cancellation, offline artwork and playback.
  Downloads are scoped to their source, server and profile; podcast episodes remain streamed.
- A restricted, authenticated audio relay for buffering and downloads, plus temporary in-memory preparation
  of the current/next song and playback recovery after network interruptions.
- Recent visits, continue listening, loading placeholders, keyboard shortcuts and faster cached browsing.
- Expanding artwork, progressive lyrics, animated panels and a gesture to open the profile menu.

### Changed
- Compact sharing controls, profile colours, track-row highlighting and album/playlist header tints.
- Minimal downloads and playlist-link import dialogs, with a full-width import action.
- The search interface no longer saves search queries or shows recent-query chips.
- Desktop updates use raw current-format installers; legacy compressed Tauri v1 update handling is disabled.
- Remove unused generation/server CLIs and update the PostCSS dependency used by the build.

### Fixed
- Canonical song identity prevents duplicates across search and album results and keeps saved indicators in sync.
- Lyrics previews keep the active line at the top; player expansion and mobile header colours are smoother.
- Brief server interruptions preserve the current page, navigation, artwork and colours. The downloads
  fallback appears only after two continuous minutes without the server; reconnection restores the page.
- Cached catalogue/profile answers bridge network failures without overriding authentication or permission errors.
- Retain proxy trust validation, strict CORS, bounded login admission, safe administrator bootstrap and
  administrative validation when integrating the new audio relay.
- A rejected combined administrator edit no longer changes a password or revokes sessions before failing.
- New profiles, configured bootstrap credentials and password resets require a passphrase of at least
  15 characters; existing logins remain compatible.
- Update the native TLS dependency resolutions to reject distrusted certificate chains.

## 0.1.25

Covers 0.1.21 to 0.1.25.

### Added
- **Calls and voice notes on Android**: the music fades out and pauses during a call or a voice note, and fades
  back in when it ends.
- **Optional PO token provider** for yt-dlp (bgutil), switched on with `YTDLP_POT_URL` and
  `YTDLP_PLUGIN_DIRS`; `/api/music/health` reports its state. See [docs/pot-provider.md](docs/pot-provider.md).
- `[stream]` log lines for failed audio resolutions and the replacements used.

### Changed
- **Devices**: music plays on the device where it is started. Opening the app never makes a device the output, and
  a silent output hands over at once. A device is remote-controlled only when it was picked in **Dispositivos** or
  is already playing. Volume is no longer synced. The devices icon is grey on the device that plays and takes the
  accent colour when another device plays (its name is in the tooltip).
- **Mobile**: the devices button moved from the bottom bar to the mini player.
- Phones always play at full scale; the system volume keys set the loudness.

### Fixed
- **Profiles**: Home, albums, artists, favourites and the server playlists of the YouTube source are now built from
  each profile's own history and likes. Before, every profile saw the server's shared legacy library, so different
  profiles looked the same. No data was mixed: likes, history and playlists were already per profile.
- **Search**: a full search shows the songs, albums or artists it found when one of its three catalogue lookups
  fails, and fails only when all of them do. A catalogue 403/429 is retried once. Temporary catalogue failures are
  a `503` with `Retry-After` (a proxy such as Cloudflare would replace a `502` body with its own page), and the app
  retries them.
- The recent-searches sync no longer polls the server in a loop.
- **Playback**: one audio request stays under a 60 s budget (below Cloudflare's 100 s origin timeout). Temporary
  failures are a `503`, and a video that will not play is a `410`. The player retries resolution, shows a plain
  connection message and skips to the next song when a song cannot play.
- A video that YouTube will not play (removed, blocked or a bot check) is replaced only by an official upload of
  the very same song (same title, same main artist, ±3 s). A replacement for a removed video is remembered; one for a
  bot check lasts 6 hours, in memory. The looser replacements of 0.1.23 are dropped.

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
