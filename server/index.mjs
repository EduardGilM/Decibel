import { createServer } from "node:http"
import { access } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import handler from "serve-handler"
import { createMusicService, createYtDlpRunner, MusicError } from "./ytdlp.mjs"
import { createYtMusicRunner } from "./ytmusic.mjs"
import { ARTWORK_MAX_AGE, createArtworkService } from "./artwork.mjs"
import { openDb } from "./db.mjs"
import { createProfileApi } from "./profile-api.mjs"
import { createPodcastService } from "./podcasts.mjs"
import { handlePodcastApi } from "./podcast-api.mjs"
import { parsePodcastFeed } from "./podcast-feed.mjs"
import { createReleases } from "./releases.mjs"
import { createRequestSecurity } from "./request-security.mjs"
import { createDevices } from "./devices.mjs"
import { createSpotifyImport } from "./spotify.mjs"
import { profileCollections } from "./profile-collections.mjs"
import { sendMusicStream } from "./music-stream.mjs"

export async function createApp({ music, publicDir, allowedOrigins = [], streamRequest, artwork = createArtworkService(), profiles, podcasts = profiles ? createPodcastService({ db: profiles.db }) : undefined, releases = createReleases({ dir: undefined }), spotify = profiles ? createSpotifyImport({ db: profiles.db, library: profiles.library, search: (query) => music.search(query, "tracks"), allowedOrigins }) : undefined, trustProxy, now = Date.now }) {
  const security = createRequestSecurity({ trustProxy })
  const devices = createDevices()
  let healthCache
  const musicHealth = () => {
    if (healthCache?.expires > now()) return healthCache.promise
    const entry = { expires: Infinity }
    entry.promise = Promise.resolve().then(() => music.health()).then(
      (result) => { entry.expires = now() + 30_000; return result },
      (error) => { entry.expires = now() + 5000; throw error },
    )
    healthCache = entry
    return entry.promise
  }
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost")
      if (!url.pathname.startsWith("/api/")) {
        // Public downloads (/download, /releases/*) from DECIBEL_RELEASES_DIR, outside the app and git.
        if (await releases.handle(req, res, url)) return
        if (!publicDir) throw new MusicError("Ruta no encontrada.", 404)
        return await handler(req, res, { public: publicDir, directoryListing: false })
      }
      res.setHeader("Cache-Control", "no-store")
      res.setHeader("Vary", "Origin")
      const origin = req.headers.origin
      if (origin) {
        if (!security.sameOrigin(req, origin) && !allowedOrigins.includes(origin)) throw new MusicError("Origen no permitido.", 403)
        res.setHeader("Access-Control-Allow-Origin", origin)
        res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS")
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Range, If-Range, X-Decibel-Purpose")
        res.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length, ETag, Last-Modified")
        res.setHeader("Access-Control-Allow-Credentials", "true")
      }
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return }
      // Latest app version for the update notice; public like /download (CORS above lets the apps read it).
      if (url.pathname === "/api/app/version" && await releases.handle(req, res, url)) return
      const json = (value, status = 200) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(value)) }
      let user
      if (profiles) {
        // The Spotify consent screen comes back without a session; its one-time state names the profile.
        if (await spotify?.callback(req, res, url)) return
        // Profiles: every /api route needs a session except login and health.
        if (await profiles.handle(req, res, url, json)) return
        user = profiles.guard(req, res, url.pathname)
      }
      if (await spotify?.handle(req, url, json, user)) return
      if (await devices.handle(req, url, json, user)) return
      if (await handlePodcastApi(req, res, url, json, user, podcasts)) return
      if (!url.pathname.startsWith("/api/music/")) throw new MusicError("Ruta no encontrada.", 404)
      const route = url.pathname.slice("/api/music/".length)
      if (["GET", "HEAD"].includes(req.method) && route === "stream") return await sendMusicStream(req, res, url.searchParams.get("id"), { music, request: streamRequest })
      const body = async () => {
        if (!req.headers["content-type"]?.startsWith("application/json")) throw new MusicError("Se requiere JSON.", 415)
        let contents = ""
        for await (const chunk of req) { contents += chunk; if (contents.length > 4096) throw new MusicError("Petición demasiado grande.", 413) }
        try { return JSON.parse(contents) } catch { throw new MusicError("JSON no válido.") }
      }
      if (req.method === "GET" && user && profiles.db) {
        // With profiles, the YouTube service's library is shared by everyone who played on this server, so
        // the library views (Home, albums, artists, favourites, playlists) come from this profile's own data.
        const own = () => profileCollections(profiles.db, user.id, "ytdlp")
        switch (route) {
          case "home": return json(own().home(await music.discovery?.()))
          case "albums": return json(own().albums(url.searchParams.get("type") || undefined))
          case "artists": return json(own().artists())
          case "playlists": return json([])
          case "playlist": throw new MusicError("Lista no encontrada.", 404)
          case "starred": return json(profiles.library.likes(user.id, "ytdlp"))
        }
      }
      if (req.method === "GET") {
        switch (route) {
          case "artwork": {
            const image = await artwork.get(url.searchParams.get("url"))
            res.writeHead(200, { "Content-Type": image.contentType, "Content-Length": image.body.length, "Cache-Control": `public, max-age=${ARTWORK_MAX_AGE}`, "X-Content-Type-Options": "nosniff" })
            res.end(image.body)
            return
          }
          case "health": return json(await musicHealth())
          case "search": {
            // A client that goes away (new keystroke, Enter, closed page) frees its YouTube Music slot.
            const gone = new AbortController()
            res.once("close", () => { if (!res.writableFinished) gone.abort() })
            return json(await music.search(url.searchParams.get("q"), url.searchParams.get("type") || "all", { signal: gone.signal }))
          }
          case "recommendations": return json(await music.recommendations(url.searchParams.get("id")))
          case "home": return json(await music.home())
          case "albums": return json(music.albums(url.searchParams.get("type")))
          case "album": return json(await music.album(url.searchParams.get("id") || ""))
          case "artists": return json(music.artists())
          case "artist": return json(await music.artist(url.searchParams.get("id")))
          case "artist-recommendations": return json(await music.artistRecommendations(url.searchParams.get("id")))
          case "playlists": return json(music.playlists())
          case "playlist": return json(music.playlist(url.searchParams.get("id")))
          case "starred": return json(music.starred())
        }
      }
      if (req.method === "POST" && route === "prepare") { const { id } = await body(); return json(await music.prepare(id)) }
      if (req.method === "POST" && route === "stream") { const { id, refresh } = await body(); return json(await music.stream(id, { refresh: refresh === true })) }
      if (req.method === "POST" && route === "playlists") { const { name, id } = await body(); return json(await music.createPlaylist(name, id), 201) }
      if (req.method === "POST" && route === "playlist-tracks") { const { playlistId, id } = await body(); return json(await music.addToPlaylist(playlistId, id)) }
      if (["PUT", "DELETE"].includes(req.method) && route === "starred") { const { id, type } = await body(); await music.star(id, type, req.method === "PUT"); return json({ ok: true }) }
      if (req.method === "POST" && route === "scrobble") { const { id, submission } = await body(); await music.scrobble(id, submission === true); return json({ ok: true }) }
      throw new MusicError("Ruta no encontrada.", 404)
    } catch (error) {
      if (res.headersSent) { res.destroy(); return }
      if (res.destroyed || res.writableEnded) return // the client already left (an aborted search)
      const status = error instanceof MusicError ? error.status : 500
      if (error.retryAfter) res.setHeader("Retry-After", String(error.retryAfter))
      if (status === 500) console.error(error)
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
      res.end(JSON.stringify({ error: status === 500 ? "Error interno del servicio de música." : error.message }))
    }
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const localBinary = resolve(root, ".tools", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp")
  const binary = process.env.YTDLP_BIN || await access(localBinary).then(() => localBinary).catch(() => "yt-dlp")
  const localPython = resolve(root, ".tools/ytmusic", process.platform === "win32" ? "Scripts/python.exe" : "bin/python")
  const python = process.env.YTMUSIC_PYTHON || await access(localPython).then(() => localPython).catch(() => process.platform === "win32" ? "python" : "python3")
  const music = await createMusicService({ dataDir: resolve(root, process.env.MUSIC_DATA_DIR || "data/music"), run: createYtDlpRunner(binary, { cacheDir: resolve(root, process.env.YTDLP_CACHE_DIR || ".tools/yt-dlp-cache"), python, worker: resolve(root, "server", "ytdlp-worker.py"), workers: Number(process.env.YTDLP_WORKERS) || undefined }), catalog: createYtMusicRunner(python, resolve(root, "server/ytmusic.py")) })
  const apiOnly = process.argv.includes("--api-only")
  const profiles = await createProfileApi({ db: openDb(resolve(root, process.env.DECIBEL_DB || "data/decibel.db")), admin: { username: process.env.DECIBEL_ADMIN_USER, password: process.env.DECIBEL_ADMIN_PASSWORD } })
  const podcasts = createPodcastService({ db: profiles.db, parseFeed: (buffer) => parsePodcastFeed(buffer, { python }) })
  const releases = createReleases({ dir: process.env.DECIBEL_RELEASES_DIR ? resolve(process.env.DECIBEL_RELEASES_DIR) : undefined })
  const defaultOrigins = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", ...(apiOnly ? ["http://localhost:3000", "http://127.0.0.1:3000"] : [])]
  const app = await createApp({ music, profiles, podcasts, releases, publicDir: apiOnly ? undefined : resolve(root, "out"), allowedOrigins: (process.env.YTDLP_ALLOWED_ORIGINS || defaultOrigins.join(",")).split(",").filter(Boolean) })
  const port = Number(apiOnly ? process.env.MUSIC_API_PORT || 3001 : process.env.MUSIC_PORT || 3000)
  app.listen(port, process.env.MUSIC_HOST || "0.0.0.0", () => console.log(`Decibel${apiOnly ? " (API)" : " + YouTube Music"}: http://localhost:${app.address().port}`))
  app.on("error", (error) => { console.error(error.message); process.exitCode = 1 })
}
