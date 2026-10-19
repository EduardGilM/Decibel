# Importing from Spotify

Decibel can copy your Spotify likes and playlists into a profile. Every song is looked up on YouTube Music and
only accepted with the same title (ignoring tags such as «feat.» or «Remastered»), at least one artist in common
and a similar length; songs that are not found are skipped. Matches are cached in `spotify_matches`, so running an
import again does not search again. Imports run in the background on the server: the dialog closes as soon as the
import starts and a small, dismissible notice keeps the count until the final result, also after reopening the app.

## One playlist by link

In **Tu biblioteca → Importar lista por enlace**, paste the link of a public Spotify playlist. Decibel creates a
playlist with the same name, in the order of the songs found on YouTube Music; the final notice says how many were
imported and how many are unavailable, and can open the playlist. No Spotify account or app is needed.

- `POST /api/playlist-import` takes `{ "url": "https://open.spotify.com/playlist/…" }` and answers when the import
  starts; `GET /api/playlist-import` returns the progress for the profile that started it.
- `spotify.link` short links and `spotify:playlist:…` URIs are accepted too.
- Up to 5000 entries are read, paging past the first 100 shown by Spotify's embedded player. If Spotify does not
  allow reading the whole playlist, no partial copy is created. Private playlists need one of the methods below.
- This uses Spotify's public metadata and may stop working if Spotify changes its format.

## Your whole library (profile menu)

In the profile menu (side panel on mobile), with YouTube as the source, **Importar de Spotify** offers two steps
that need no account or registration:

1. **Abrir Exportify** opens [exportify.app](https://exportify.app) (free, open source and already authorised by
   Spotify): log in with Spotify and press «Export All».
2. **Elegir el archivo descargado** uploads that ZIP (one CSV per playlist plus `liked.csv`) to
   `POST /api/spotify/file`.

Single Exportify CSVs, Spotify's own data download (`YourLibrary.json`, `Playlist*.json`) and a CSV with a
«Playlist name» column are accepted too. Exportify translates its headers, so its format is read by column position.
Likes keep Spotify's order and playlists whose name already exists are not duplicated. Up to 5000 songs and 200
playlists per import.

### Optional: a Spotify app on the server

If the server has a Spotify app enabled, the dialog shows a single **Importar** button instead, which opens
Spotify's consent screen (OAuth with PKCE; no client secret). The server then imports the likes and the owned or
collaborative playlists of that account into the profile that started it; the OAuth `state` names the profile, so
the callback needs no session. The Spotify token is only kept in memory while the library is read. On the web and
desktop the window goes to Spotify and back; on Android the system browser opens and you return to the app by hand.

To enable it once:

1. Create an app at [developer.spotify.com](https://developer.spotify.com/dashboard) (Spotify currently requires
   the owner to have Premium) with the redirect URI `https://<your server>/api/spotify/callback`.
2. Under «User Management», add the Spotify accounts that will import (development mode allows 5).
3. Save its Client ID as an admin with `PUT /api/spotify/config`; it is stored in `server_settings`.

The app shows no configuration for this.
