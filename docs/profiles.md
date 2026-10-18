# Profiles, sessions and API

Decibel stores profiles in SQLite (`node:sqlite`) at `data/decibel.db` (change it with `DECIBEL_DB`). `data/` is
not versioned.

## First start

With an empty database the server creates **a single administrator profile**:

- Name: `DECIBEL_ADMIN_USER` (default `admin`).
- Password: `DECIBEL_ADMIN_PASSWORD`. If it is not set, a random one is generated and printed **only once** in the
  start-up log. Save it and change it in `/admin`.
- The password is stored only as a scrypt hash.
- If profiles already exist nothing is created or modified; the variables are ignored.

The administrator creates the other profiles from **Perfiles** (`/admin`).

- User names are case-insensitive (`alex` = `Alex`); passwords are case-sensitive.

## Sessions

- Log in once per device: `decibel_session` cookie (HttpOnly, SameSite=Lax, `Secure` behind HTTPS) valid for one
  year with sliding renewal (each day of use extends it). Native apps can use `Authorization: Bearer <token>`.
- Only the SHA-256 of the token is stored in the database.
- Changing a password signs that profile out on other devices; deactivating a profile signs it out everywhere.
- Failed logins are rate-limited: 5 per name and 8 per IP every 10 minutes (`429` + `Retry-After`).
- Without a session a name/password form is shown, without listing profiles. An APK built with a fixed server
  does not offer to switch the music source.

## API

Every `/api/*` endpoint requires a session except `GET /api/health`, `GET /api/music/health` and
`POST /api/auth/login`. `OPTIONS` requests allow the CORS preflight without a session.

| Route | Purpose |
| --- | --- |
| `GET /api/auth/profiles` | minimal list of active profiles (`id`, `name`, `color`) for sharing playlists |
| `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/password` | current session, log out, change your own password (asks for the current one) |
| `GET/POST /api/admin/users`, `PATCH /api/admin/users/:id` | admin only: list, create, activate/deactivate, reset password, role |
| `/api/me/likes`, `/api/me/history`, `/api/me/settings` | profile data, separated by source (`mock`, `subsonic`, `ytdlp`) |
| `POST /api/me/import` | one-off import of what the device stored before profiles existed |
| `/api/playlists[/:id[/tracks\|/move\|/members]]` | private, shared (viewer/editor) and collaborative playlists, with "added by" |

Shared playlists: the creator is the owner (rename, delete, share); editors add, remove and reorder; viewers can
only see it. A collaborative playlist can be seen and edited by every profile.

### Music catalogue

| Route | Purpose |
| --- | --- |
| `GET /api/music/search?q=…&type=all\|tracks\|albums\|artists` | `{ tracks, albums, artists }`; `all` returns up to 8 artists, `artists` up to 20 |
| `GET /api/music/album?id=…`, `GET /api/music/artist?id=…` | album and artist pages (artist: top tracks, albums, singles) |
| `GET /api/music/artist-recommendations?id=ytm-artist:…` | the artist's own songs not in its top tracks, less-known songs from its discography and similar artists |
| `GET /api/music/stream?id=…`, `POST /api/music/prepare` | resolve (or pre-resolve) a short-lived audio URL |

Catalogue tracks include `artists: { id?, name }[]` with every credited artist, so the app can link each featured
artist to its own page. Catalogue responses are cached in memory on the server (search ≈ 1 min, artist data
≈ 30 min); audio is never stored.

## Tests

`node --test server/profiles.test.mjs` covers hashing, first start, case-insensitivity, sliding sessions, rate
limiting, admin permissions, per-profile isolation, import and playlist permissions.

## Offline downloads

- Only for sources other than YouTube (Navidrome/Subsonic and demo). ⤓ button in album and playlist headers;
  `/downloads/` page.
- Audio is stored in Cache Storage (`decibel-offline-v1`, kept by the service worker across versions) and played
  from there without a connection. Two downloads at a time.
- Per-device storage limit: 2 GB by default, configurable in the playback settings (512 MB – 10 GB).
- YouTube is blocked on the client (`canDownload`) and on the server: any `/api/music/*` request with
  `X-Decibel-Purpose: download` gets `403`.
