import { createHash, randomBytes } from "node:crypto"
import { inflateRawSync } from "node:zlib"
import { MusicError } from "./errors.mjs"
import { readJson } from "./profile-api.mjs"
import { readSpotifyPlaylist, spotifyPlaylistLink } from "./spotify-playlist.mjs"

const ACCOUNTS = "https://accounts.spotify.com"
const API = "https://api.spotify.com/v1"
const SCOPES = "playlist-read-private playlist-read-collaborative user-library-read"
const STATE_MS = 15 * 60_000
const MISS_MS = 7 * 86_400_000
const MAX_TRACKS = 5000
const MAX_UPLOAD = 20_000_000
const MAX_UNZIPPED = 60_000_000
// Imports share two catalogue lookups at a time, so searches by people using the app keep a free slot.
const SEARCHES = 2
const RUNNING = ["connecting", "matching", "saving"]

const normalize = (value) => String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")
/** "Song - Remastered 2011", "Song (feat. X)", "Song [Live]" → "Song". */
const bareTitle = (value) => String(value ?? "").replace(/\s*[([][^)\]]*[)\]]/g, "").replace(/\s+-\s+.*$/, "").trim()
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The same recording: same title (ignoring "(feat. …)", "- Remastered"…), a shared artist and a similar length. */
export function matchTrack(wanted, candidates) {
  const artists = new Set(wanted.artists.map(normalize).filter(Boolean))
  const title = normalize(wanted.title), bare = normalize(bareTitle(wanted.title))
  let best, bestScore = -Infinity
  for (const track of Array.isArray(candidates) ? candidates : []) {
    const credited = track.artists?.length ? track.artists.map((a) => a.name) : String(track.artist ?? "").split(/\s*(?:,|&|\bfeat\.?|\bft\.?)\s*/i)
    if (!credited.some((name) => artists.has(normalize(name)))) continue
    const other = normalize(track.title), otherBare = normalize(bareTitle(track.title))
    const level = other === title ? 3 : bare && otherBare === bare ? 2
      : bare.length >= 4 && otherBare.length >= 4 && (otherBare.includes(bare) || bare.includes(otherBare)) ? 1 : 0
    if (!level) continue
    const gap = wanted.duration && track.duration ? Math.abs(track.duration - wanted.duration) : undefined
    if (gap === undefined ? level < 2 : gap > (level === 1 ? 3 : 7)) continue
    const score = level * 10 - (gap ?? 5)
    if (score > bestScore) { best = track; bestScore = score }
  }
  return best
}

/** What to look for on YouTube Music. The Spotify track id, when known, keys the shared match cache. */
function wanted(title, artists, duration, id) {
  title = String(title ?? "").trim()
  artists = [...new Set(artists.map((a) => String(a ?? "").trim()).filter(Boolean))]
  if (!title || !artists.length) return null
  const key = id ? `spotify:${id}` : `local:${normalize(title)}:${normalize(artists[0])}`
  return { key: key.slice(0, 300), title, artists, duration: duration > 0 ? duration : 0 }
}

/** A Spotify playlist item or saved track → what to look for (null for episodes and incomplete entries). */
function wantedTrack(entry) {
  const track = entry?.item ?? entry?.track
  if (!track || (track.type && track.type !== "track") || typeof track.name !== "string") return null
  // Local files have no Spotify id.
  return wanted(track.name, (Array.isArray(track.artists) ? track.artists : []).map((a) => a?.name), track.duration_ms / 1000, typeof track.id === "string" && track.id)
}

// ---- files: the ZIP/CSV of Exportify (exportify.app) or Spotify's own data download ----
const spotifyId = (value) => /^(?:spotify:track:)?([A-Za-z0-9]{22})$/.exec(String(value ?? "").trim())?.[1]
const LIKED = /^(liked|liked[ _]songs|canciones[ _]que[ _]te[ _]gustan|tus[ _]me[ _]gusta|me[ _]gusta)$/i
const listName = (file) => { const name = file.replace(/\.csv$/i, "").replace(/_+/g, " ").trim(); return name.charAt(0).toUpperCase() + name.slice(1) }

/** RFC 4180: quoted cells may hold commas, quotes and newlines. */
function csvRows(text) {
  const rows = []
  let row = [], cell = "", quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') cell += c
      else if (text[i + 1] === '"') { cell += '"'; i++ }
      else quoted = false
    } else if (c === '"') quoted = true
    else if (c === ",") { row.push(cell); cell = "" }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(cell); cell = ""
      if (row.some(Boolean)) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some(Boolean)) rows.push(row)
  return rows
}

function csvTracks(text) {
  const [header = [], ...rows] = csvRows(text.replace(/^\uFEFF/, ""))
  // exportify.app translates its headers, but its first 19 columns never move: names 1 and 3 (", " between
  // artists, "\," inside a name), duration 12, added (liked) date 18.
  if (header.length >= 19 && rows.some((r) => /^spotify:artist:/.test(r[2] ?? ""))) {
    return rows.map((r) => ({ wanted: wanted(r[1], String(r[3] ?? "").split(/(?<!\\),\s*/).map((a) => a.replace(/\\,/g, ",")), Number(r[12]) / 1000, spotifyId(r[0])), at: Date.parse(r[18]) }))
  }
  const names = header.map((h) => h.trim().toLowerCase())
  const col = (...options) => names.findIndex((n) => options.includes(n))
  const title = col("track name", "track", "name", "title", "song"), artist = col("artist name(s)", "artist names", "artist name", "artists", "artist")
  if (title < 0 || artist < 0) return []
  const duration = col("duration (ms)", "track duration (ms)"), id = col("track uri", "uri", "spotify - id", "spotify id"), added = col("added at"), list = col("playlist name", "playlist")
  return rows.map((r) => ({
    wanted: wanted(r[title], [...String(r[artist] ?? "").split(/\s*[,;]\s*/), r[artist]], Number(r[duration]) / 1000, spotifyId(r[id])),
    at: Date.parse(r[added]),
    list: list >= 0 ? r[list] : undefined,
  }))
}

/** Stored and deflated entries of a ZIP, bounded so a crafted file cannot exhaust memory. */
function unzip(buffer) {
  const broken = () => new MusicError("El archivo ZIP está dañado.")
  let end = -1
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break }
  if (end < 0) throw broken()
  const files = []
  let offset = buffer.readUInt32LE(end + 16), total = 0
  for (let n = buffer.readUInt16LE(end + 10); n > 0; n--) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw broken()
    const method = buffer.readUInt16LE(offset + 10), size = buffer.readUInt32LE(offset + 20), local = buffer.readUInt32LE(offset + 42)
    const nameEnd = offset + 46 + buffer.readUInt16LE(offset + 28)
    const name = buffer.toString("utf8", offset + 46, nameEnd)
    offset = nameEnd + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32)
    if (!/\.(csv|json)$/i.test(name) || ![0, 8].includes(method)) continue
    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== 0x04034b50) throw broken()
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28)
    const raw = buffer.subarray(start, start + size)
    let data
    try { data = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: MAX_UNZIPPED }) } catch { throw broken() }
    if ((total += data.length) > MAX_UNZIPPED) throw new MusicError("El archivo es demasiado grande.", 413)
    files.push({ name, data })
  }
  return files
}

/** Liked songs and lists from an Exportify ZIP/CSV or Spotify's data download (YourLibrary.json, Playlist*.json). */
export function parseLibraryFile(buffer, filename = "") {
  const files = buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50 ? unzip(buffer) : [{ name: filename, data: buffer }]
  const liked = [], playlists = [], grouped = new Map()
  const add = (name, entries) => {
    if (LIKED.test(name.trim())) liked.push(...entries.filter((e) => e.wanted))
    else {
      const tracks = entries.map((e) => e.wanted).filter(Boolean)
      if (tracks.length) playlists.push({ name: name.slice(0, 100), tracks })
    }
  }
  for (const { name, data } of files) {
    const file = name.split("/").pop() ?? ""
    if (/\.json$/i.test(file)) {
      let json
      try { json = JSON.parse(data.toString("utf8").replace(/^\uFEFF/, "")) } catch { continue }
      if (Array.isArray(json?.tracks)) add("liked", json.tracks.map((t) => ({ wanted: wanted(t?.track, [t?.artist], 0, spotifyId(t?.uri)) })))
      for (const list of Array.isArray(json?.playlists) ? json.playlists : []) {
        add(String(list?.name || "Spotify"), (Array.isArray(list?.items) ? list.items : []).map((i) => ({ wanted: wanted(i?.track?.trackName, [i?.track?.artistName], 0, spotifyId(i?.track?.trackUri)) })))
      }
      continue
    }
    const entries = csvTracks(data.toString("utf8"))
    // One CSV holding every list (a "Playlist name" column).
    if (!entries.some((e) => e.list)) { add(listName(file) || "Spotify", entries); continue }
    for (const e of entries) {
      if (!grouped.has(e.list)) grouped.set(e.list, [])
      grouped.get(e.list).push(e)
    }
  }
  for (const [name, entries] of grouped) add(name || "Spotify", entries)
  if (!liked.length && !playlists.length) throw new MusicError("No encuentro canciones en este archivo. Elige el ZIP que descarga Exportify.")
  return { liked, playlists }
}

async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    if ((size += chunk.length) > limit) throw new MusicError("El archivo es demasiado grande.", 413)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** `base` of the Decibel server as the client reaches it (the Redirect URI registered in Spotify hangs from it). */
function serverBase(value) {
  try {
    const url = new URL(value)
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null
    return (url.origin + url.pathname).replace(/\/+$/, "")
  } catch { return null }
}

/**
 * Spotify → profile import. The profile is fixed when the import starts (OAuth `state`), so the callback needs
 * no session: it may finish in another browser (the Android app opens the system one). Liked songs and the
 * user's own playlists are matched on YouTube Music in the background and saved through `library.import`.
 * Spotify tokens live only in memory for the length of the read.
 */
export function createSpotifyImport({ db, library, search, allowedOrigins = [], fetch = globalThis.fetch, accounts = ACCOUNTS, api = API, now = Date.now, wait = (ms) => new Promise((done) => setTimeout(done, ms)) }) {
  const pending = new Map()
  const jobs = new Map()
  const playlistJobs = new Map()
  let active = 0
  const queue = []
  const slot = () => new Promise((resolve) => {
    const start = () => { active++; resolve(() => { active--; queue.shift()?.() }) }
    if (active < SEARCHES) start()
    else queue.push(start)
  })

  const clientId = () => db.prepare("SELECT value FROM server_settings WHERE key = 'spotify_client_id'").get()?.value
  const running = (userId) => RUNNING.includes(jobs.get(userId)?.status)
  const view = (job) => job ? { status: job.status, done: job.done, total: job.total, result: job.result, error: job.error } : null
  const fail = (job, message) => Object.assign(job, { status: "error", error: message })

  /** Only back to this web (same host) or an app shell origin. */
  function returnOrigin(value, host) {
    try {
      const url = new URL(value)
      if (url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) return undefined
      const origin = `${url.protocol}//${url.host}`
      const web = ["http:", "https:"].includes(url.protocol) && url.hostname === new URL(`http://${host}`).hostname
      return web || allowedOrigins.includes(origin) ? origin : undefined
    } catch { return undefined }
  }

  async function spotify(url, token) {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) }).catch(() => null)
      if (response?.ok) return response.json()
      const status = response?.status ?? 0
      if ((!status || status === 429 || status >= 500) && attempt < 4) {
        await wait(Math.min(30, Number(response?.headers.get("retry-after")) || 2 ** attempt) * 1000)
        continue
      }
      const error = new MusicError(
        status === 403 ? "Spotify no da acceso a esta cuenta. El administrador debe añadirla en su app de Spotify."
          : status === 429 ? "Spotify ha limitado las peticiones. Inténtalo más tarde."
            : status === 401 ? "Spotify ha cerrado la conexión. Vuelve a conectar." : "Spotify no responde. Vuelve a intentarlo.", 502)
      error.spotifyStatus = status
      throw error
    }
  }

  async function all(path, token, limit) {
    const items = []
    let url = api + path
    while (url && items.length < limit) {
      if (!url.startsWith(`${api}/`)) throw new MusicError("Spotify ha devuelto una respuesta no válida.", 502)
      const page = await spotify(url, token)
      if (Array.isArray(page?.items)) items.push(...page.items)
      url = typeof page?.next === "string" ? page.next : null
    }
    return items.slice(0, limit)
  }

  function cached(key) {
    const row = db.prepare("SELECT track_json, checked_at FROM spotify_matches WHERE key = ?").get(key)
    if (!row) return undefined
    if (!row.track_json) return now() - row.checked_at < MISS_MS ? null : undefined
    try { return JSON.parse(row.track_json) } catch { return undefined }
  }
  const remember = (key, track) => db.prepare("INSERT INTO spotify_matches (key, track_json, checked_at) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET track_json = excluded.track_json, checked_at = excluded.checked_at")
    .run(key, track ? JSON.stringify(track) : null, now())

  async function find(wanted, state) {
    const known = cached(wanted.key)
    if (known !== undefined) return known
    const query = `${bareTitle(wanted.title) || wanted.title} ${wanted.artists[0]}`
    for (let attempt = 0; attempt < 2; attempt++) {
      const release = await slot()
      try {
        const match = matchTrack(wanted, (await search(query))?.tracks)
        const track = match ? { ...match, starred: undefined } : null
        remember(wanted.key, track)
        state.failures = 0
        return track
      } catch {
        // one more try; a failed lookup is not remembered as "not on YouTube Music"
      } finally { release() }
    }
    if (++state.failures >= 10) throw new MusicError("YouTube Music no responde. Vuelve a intentarlo más tarde.", 502)
    return null
  }

  async function read(token) {
    const me = await spotify(`${api}/me`, token)
    // Spotify only lists the items of playlists the user owns or collaborates on.
    const lists = (await all("/me/playlists?limit=50", token, 1000)).filter((p) => p?.id && typeof p.name === "string" && (p.owner?.id === me?.id || p.collaborative))
    const playlists = []
    for (const list of lists.slice(0, 200)) {
      try {
        const entries = await all(`/playlists/${encodeURIComponent(list.id)}/items?limit=50&additional_types=track`, token, 2000)
        playlists.push({ name: list.name.trim() || "Spotify", tracks: entries.map(wantedTrack).filter(Boolean) })
      } catch (error) {
        if (![403, 404].includes(error.spotifyStatus)) throw error
      }
    }
    const liked = (await all("/me/tracks?limit=50", token, MAX_TRACKS)).map((entry) => ({ wanted: wantedTrack(entry), at: Date.parse(entry?.added_at) })).filter((l) => l.wanted)
    return { liked, playlists }
  }

  /** Both import features share the cache and catalogue slots, but keep separate jobs and saved results. */
  async function matches(job, entries) {
    const unique = [...new Map(entries.map((w) => [w.key, w])).values()].slice(0, MAX_TRACKS)
    Object.assign(job, { status: "matching", done: 0, total: unique.length })

    const found = new Map(), state = { failures: 0, stop: false }
    let cursor = 0
    await Promise.all(Array.from({ length: Math.min(SEARCHES, unique.length) }, async () => {
      while (!state.stop && cursor < unique.length) {
        const wanted = unique[cursor++]
        try {
          const track = await find(wanted, state)
          if (track) found.set(wanted.key, track)
        } catch (error) { state.stop = true; throw error }
        job.done++
      }
    }))
    return found
  }

  /** `load` gives the liked songs and lists (Spotify's API or an uploaded file); they are matched and saved here. */
  async function run(job, userId, load) {
    try {
      const { liked, playlists } = await load()
      const found = await matches(job, [...liked.map((l) => l.wanted), ...playlists.flatMap((p) => p.tracks)])

      job.status = "saving"
      const likes = liked.map(({ wanted, at }) => ({ kind: "track", item: found.get(wanted.key), at: Number.isFinite(at) ? at : undefined })).filter((l) => l.item)
      const counts = library.import(userId, "ytdlp", {
        likes,
        playlists: playlists.map((p) => ({ name: p.name, tracks: p.tracks.map((w) => found.get(w.key)).filter(Boolean) })).filter((p) => p.tracks.length),
      })
      Object.assign(job, { status: "done", result: { playlists: counts.playlists, likes: counts.likes, missing: job.total - found.size } })
    } catch (error) {
      if (!(error instanceof MusicError)) console.error(error)
      fail(job, error instanceof MusicError ? error.message : "No se ha podido importar de Spotify.")
    }
  }

  async function runPlaylist(job, userId, link) {
    try {
      const list = await readSpotifyPlaylist(link, { fetch, wait, progress: (done, total) => Object.assign(job, { done, total }) })
      const entries = list.tracks.map((t) => wanted(t.title, t.artists, t.duration, t.id))
      const found = await matches(job, entries)
      const tracks = entries.map((w) => found.get(w.key)).filter(Boolean)
      if (!tracks.length) throw new MusicError("No se han encontrado las canciones de esta lista en YouTube Music.")
      if (!db.prepare("SELECT active FROM users WHERE id = ?").get(userId)?.active) throw new MusicError("Este perfil ya no está activo.", 403)
      job.status = "saving"
      const playlist = library.createPlaylist(userId, "ytdlp", list.name, tracks)
      Object.assign(job, { status: "done", result: { playlist: { id: playlist.id, name: playlist.name, songCount: playlist.songCount }, missing: list.unavailable + entries.length - tracks.length } })
    } catch (error) {
      if (!(error instanceof MusicError)) console.error(error)
      fail(job, error instanceof MusicError ? error.message : "No se ha podido importar esta lista.")
    }
  }

  function page(res, message, back, auto = false) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" })
    res.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Decibel</title>${auto ? `<meta http-equiv="refresh" content="0;url=${escape(back)}">` : ""}<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:#121212;color:#fff;font:16px/1.5 system-ui,sans-serif;text-align:center}a{color:#1ed760}</style><p>${escape(message)}${back ? `<br><a href="${escape(back)}">Volver a Decibel</a>` : ""}</p></html>`)
  }

  return {
    /** Public: Spotify sends the browser here after the consent screen. */
    async callback(req, res, url) {
      if (url.pathname !== "/api/spotify/callback" || req.method !== "GET") return false
      const state = url.searchParams.get("state") ?? ""
      const started = pending.get(state)
      pending.delete(state)
      if (!started || started.expires <= now()) return page(res, "El enlace ha caducado. Vuelve a Decibel e inténtalo otra vez."), true
      const back = started.returnTo && `${started.returnTo}/?spotify=1`
      if (running(started.userId)) return page(res, "Ya se está importando tu música.", back, !!back), true
      const job = { status: "connecting", done: 0, total: 0 }
      jobs.set(started.userId, job)
      const code = url.searchParams.get("code")
      if (url.searchParams.get("error") || !code) return page(res, fail(job, "Has cancelado la conexión con Spotify.").error, back, !!back), true
      if (!db.prepare("SELECT active FROM users WHERE id = ?").get(started.userId)?.active) return page(res, fail(job, "Este perfil ya no está activo.").error), true
      const response = await fetch(`${accounts}/api/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: started.redirectUri, client_id: started.clientId, code_verifier: started.verifier }),
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null)
      const token = (await response?.json().catch(() => null))?.access_token
      if (!response?.ok || typeof token !== "string") return page(res, fail(job, "Spotify no ha aceptado la conexión. Inténtalo otra vez.").error, back, !!back), true
      void run(job, started.userId, () => read(token))
      return page(res, back ? "Volviendo a Decibel…" : "Listo. Vuelve a Decibel.", back, !!back), true
    },

    async handle(req, url, json, user) {
      const path = url.pathname
      // Single public playlist: no Spotify account/config, no profile-library import and its own progress.
      if (path === "/api/playlist-import") {
        if (req.method === "GET") return json({ job: view(playlistJobs.get(user.id)) }), true
        if (req.method === "POST") {
          const link = spotifyPlaylistLink((await readJson(req, 4000))?.url)
          if (["reading", "matching", "saving"].includes(playlistJobs.get(user.id)?.status)) throw new MusicError("Ya se está importando una lista.", 409)
          const job = { status: "reading", done: 0, total: 0 }
          playlistJobs.set(user.id, job)
          void runPlaylist(job, user.id, link)
          return json(view(job), 202), true
        }
        throw new MusicError("Método no permitido.", 405)
      }
      if (path !== "/api/spotify" && !path.startsWith("/api/spotify/")) return false
      if (path === "/api/spotify" && req.method === "GET") return json({ configured: !!clientId(), job: view(jobs.get(user.id)) }), true

      if (path === "/api/spotify/connect" && req.method === "POST") {
        const id = clientId()
        if (!id) throw new MusicError("Spotify no está activado en este servidor.", 409)
        if (running(user.id)) throw new MusicError("Ya se está importando tu música de Spotify.", 409)
        const { base, returnTo } = await readJson(req, 2000)
        const origin = serverBase(base)
        if (!origin) throw new MusicError("La dirección del servidor no es válida.")
        jobs.delete(user.id)
        for (const [key, value] of pending) if (value.expires <= now() || value.userId === user.id) pending.delete(key)
        const verifier = randomBytes(48).toString("base64url")
        const state = randomBytes(24).toString("base64url")
        const redirectUri = `${origin}/api/spotify/callback`
        pending.set(state, { userId: user.id, clientId: id, verifier, redirectUri, returnTo: returnOrigin(returnTo, req.headers.host), expires: now() + STATE_MS })
        const params = new URLSearchParams({ response_type: "code", client_id: id, scope: SCOPES, redirect_uri: redirectUri, state, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"), show_dialog: "true" })
        return json({ url: `${accounts}/authorize?${params}` }), true
      }

      // No Spotify app needed: the ZIP that exportify.app downloads (or Spotify's data download).
      if (path === "/api/spotify/file" && req.method === "POST") {
        if (running(user.id)) throw new MusicError("Ya se está importando tu música de Spotify.", 409)
        const parsed = parseLibraryFile(await readBody(req, MAX_UPLOAD), url.searchParams.get("name") ?? "")
        const job = { status: "connecting", done: 0, total: 0 }
        jobs.set(user.id, job)
        void run(job, user.id, async () => parsed)
        return json(view(job)), true
      }

      if (path === "/api/spotify/config" && req.method === "PUT") {
        if (user.role !== "admin") throw new MusicError("Solo el administrador puede hacer esto.", 403)
        const value = String((await readJson(req, 2000)).clientId ?? "").trim()
        if (value && !/^[0-9a-f]{32}$/i.test(value)) throw new MusicError("El Client ID de Spotify tiene 32 caracteres (números y letras de la a a la f).")
        if (value) db.prepare("INSERT INTO server_settings (key, value) VALUES ('spotify_client_id', ?) ON CONFLICT DO UPDATE SET value = excluded.value").run(value)
        else db.prepare("DELETE FROM server_settings WHERE key = 'spotify_client_id'").run()
        return json({ configured: !!value }), true
      }
      throw new MusicError("Ruta no encontrada.", 404)
    },
  }
}
