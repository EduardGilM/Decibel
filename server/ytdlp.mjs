import { execFile, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { delimiter, dirname, resolve } from "node:path"
import { MusicError } from "./errors.mjs"
import { catalogId, mapCatalogAlbum, mapCatalogArtist, mapCatalogTrack, mapHomeAlbums, playableSong, thumbnail } from "./ytmusic.mjs"

export { MusicError } from "./errors.mjs"

export function videoId(value) {
  const id = typeof value === "string" ? value.replace(/^yt:/, "") : ""
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) throw new MusicError("El identificador de YouTube no es válido.")
  return id
}

export function searchTarget(value) {
  const query = typeof value === "string" ? value.trim() : ""
  if (!query || query.length > 300) throw new MusicError("Escribe una búsqueda o un enlace de YouTube (máximo 300 caracteres).")
  if (/^(https?:\/\/|(?:www\.|music\.|m\.)?youtube\.com\/|youtu\.be\/)/i.test(query)) {
    let url
    try { url = new URL(/^https?:\/\//i.test(query) ? query : `https://${query}`) } catch { throw new MusicError("Enlace de YouTube no válido.") }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || !["youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com", "youtu.be"].includes(url.hostname)) {
      throw new MusicError("Introduce un enlace de youtube.com o youtu.be.")
    }
    const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.pathname === "/watch" ? url.searchParams.get("v") : /^\/(shorts|embed|live)\//.test(url.pathname) ? url.pathname.split("/")[2] : ""
    return { target: `https://www.youtube.com/watch?v=${videoId(id)}`, flat: false }
  }
  return { target: `ytsearch12:${query}`, flat: true }
}

export function mapTrack(info) {
  const id = videoId(info.id)
  const artist = info.artist || info.uploader || info.channel || "YouTube"
  const album = info.album || info.track || info.title || "YouTube"
  const artistId = `yt-artist:${artist}`
  return {
    id: `yt:${id}`, title: info.track || info.title || "Sin título", artist, artistId,
    album, albumId: `yt-album:${id}`,
    coverArt: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    duration: Number.isFinite(info.duration) ? info.duration : 0,
    year: info.release_year || (info.upload_date ? Number(info.upload_date.slice(0, 4)) : undefined),
  }
}

function createCliRunner(binary, cacheDir) {
  return (args, timeout = 60_000) => new Promise((resolveResult, reject) => {
    execFile(binary, [
      "--ignore-config", "--no-plugin-dirs", ...(cacheDir ? ["--cache-dir", cacheDir] : ["--no-cache-dir"]), "--no-warnings", "--no-progress", "--no-playlist",
      "--js-runtimes", `node:${process.execPath}`, "--socket-timeout", "15", "--retries", "1", "--extractor-retries", "1", ...args,
    ], { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.trim().split("\n").filter((line) => line.startsWith("ERROR:")).pop()?.replace(/^ERROR:\s*/, "")
        reject(new MusicError(error.code === "ENOENT" ? "Falta yt-dlp en el servidor. Ejecuta npm run music:setup." : error.killed ? "YouTube ha tardado demasiado. Vuelve a intentarlo." : detail || "No se pudo obtener el audio de YouTube.", 502))
      } else resolveResult(stdout.trim())
    })
  })
}

// Trabajador residente: evita arrancar un proceso nuevo por canción (≈0,45 s) y reaprovecha la
// conexión y los retos JS de YouTube entre canciones (≈2,2 s → ≈1 s). Conserva la interfaz
// run(args, timeout): los únicos usos son ["--version"] y la extracción con la URL al final.
function createResidentRunner({ python, script, cacheDir, size = 2 }) {
  const workers = []
  let disabled = false
  let sequence = 0

  const hatch = () => {
    const alive = workers.filter((worker) => worker.alive)
    if (alive.length >= size) return alive.toSorted((a, b) => a.pending.size - b.pending.size)[0]
    const worker = { pending: new Map(), alive: true }
    worker.ready = new Promise((resolveReady, rejectReady) => { worker.settle = resolveReady; worker.fail = rejectReady })
    // El reto JS de YouTube usa el Node del propio servidor aunque no esté en el PATH.
    worker.proc = spawn(python, [script, ...(cacheDir ? [cacheDir] : []), process.execPath], {
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      env: { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH || ""}` },
    })
    let output = "", diagnostics = ""
    worker.proc.stdout.setEncoding("utf8")
    worker.proc.stdout.on("data", (chunk) => {
      output += chunk
      for (let newline; (newline = output.indexOf("\n")) >= 0;) {
        const line = output.slice(0, newline)
        output = output.slice(newline + 1)
        let message
        try { message = JSON.parse(line) } catch { continue }
        if (message.event === "ready") { worker.version = message.version; worker.settle(); continue }
        const pending = worker.pending.get(message.id)
        if (!pending) continue
        worker.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.ok) pending.resolve(message)
        else pending.reject(new MusicError(String(message.error || "No se pudo obtener el audio de YouTube.").replace(/^ERROR:\s*/, ""), 502))
      }
    })
    worker.proc.stderr.setEncoding("utf8")
    worker.proc.stderr.on("data", (chunk) => { diagnostics = (diagnostics + chunk).slice(-2000) })
    // Un stdin muerto (trabajador eliminado por timeout) emite EPIPE: se ignora.
    worker.proc.stdin.on("error", () => {})
    const die = () => {
      if (!worker.alive) return
      worker.alive = false
      workers.splice(workers.indexOf(worker), 1)
      for (const pending of worker.pending.values()) { clearTimeout(pending.timer); pending.reject(new MusicError("No se pudo obtener el audio de YouTube.", 502)) }
      // Morir antes de "ready" (Python ausente o sin yt-dlp) no se arregla reintentando.
      if (!worker.version) {
        if (diagnostics.trim()) console.error(`El trabajador de yt-dlp no arrancó:\n${diagnostics.trim()}`)
        worker.fail(Object.assign(new MusicError("El trabajador de yt-dlp no está disponible.", 502), { permanent: true }))
      }
    }
    worker.proc.on("error", die)
    worker.proc.on("exit", die)
    // Sin esta referencia el servidor no podría apagarse mientras un trabajador esté inactivo.
    worker.proc.unref()
    worker.proc.stdin.unref?.()
    worker.proc.stdout.unref?.()
    worker.proc.stderr.unref?.()
    workers.push(worker)
    return worker
  }

  const acquire = async (timeout) => {
    const worker = workers.find((candidate) => candidate.alive && candidate.pending.size === 0) ?? hatch()
    let timer
    try {
      // Un trabajador que muere antes de responder "ready" (Python sin yt-dlp) desactiva el modo residente.
      await Promise.race([
        worker.ready,
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new MusicError("El trabajador de yt-dlp no está disponible.", 502), { permanent: true })), timeout) }),
      ])
    } finally { clearTimeout(timer) }
    return worker
  }

  const request = (worker, payload, timeout) => new Promise((resolveResult, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => {
      // Marcar aquí, no en el evento exit: puede elegirse un zombi antes de que llegue.
      worker.alive = false
      workers.splice(workers.indexOf(worker), 1)
      worker.pending.delete(id)
      worker.proc.kill("SIGKILL")
      reject(new MusicError("YouTube ha tardado demasiado. Vuelve a intentarlo.", 502))
    }, timeout)
    worker.pending.set(id, { timer, resolve: resolveResult, reject })
    worker.proc.stdin.write(`${JSON.stringify({ id, ...payload })}\n`)
  })

  return async (args, timeout = 60_000) => {
    if (disabled) throw Object.assign(new MusicError("El trabajador de yt-dlp no está disponible.", 502), { permanent: true })
    const worker = await acquire(timeout)
    const payload = args[0] === "--version" ? { op: "version" } : { op: "extract", url: args.at(-1), direct: args.includes("youtube:skip=hls") }
    const answer = await request(worker, payload, timeout)
    return payload.op === "version" ? String(answer.version) : JSON.stringify(answer.info)
  }
}

export function createYtDlpRunner(binary, { cacheDir, python, worker, workers } = {}) {
  const fallback = createCliRunner(binary, cacheDir)
  if (!python || !worker) return fallback
  const resident = createResidentRunner({ python, script: worker, cacheDir, size: workers })
  // Warm-up del primer trabajador en segundo plano: la primera canción no paga el import.
  void resident(["--version"], 30_000).catch(() => {})
  return async (args, timeout) => {
    try {
      return await resident(args, timeout)
    } catch (error) {
      if (!error?.permanent) throw error
      return fallback(args, timeout)
    }
  }
}

export async function createMusicService({ dataDir, run, catalog }) {
  await mkdir(dataDir, { recursive: true })
  const libraryFile = resolve(dataDir, "library.json")
  let library
  try { library = JSON.parse(await readFile(libraryFile, "utf8")) } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`No se puede leer ${libraryFile}: ${error.message}`)
    library = { tracks: {}, likes: { track: [], album: [], artist: [] } }
  }
  library.playlists ??= []
  let writing = Promise.resolve()
  const persist = () => {
    const contents = JSON.stringify(library, null, 2)
    writing = writing.catch(() => {}).then(async () => {
      await writeFile(`${libraryFile}.tmp`, contents)
      await rename(`${libraryFile}.tmp`, libraryFile)
    })
    return writing
  }
  const metadata = new Map()
  const streams = new Map()
  const streamCache = new Map()
  const catalogRequests = new Map()
  let lastDiscovery = { newest: [], random: [] }
  let activeCatalogRequests = 0
  const fromCatalog = async (operation, value, ttl = 5 * 60_000) => {
    const key = `${operation}:${value}`
    const cached = catalogRequests.get(key)
    if (cached && cached.expires > Date.now()) return cached.promise
    if (!catalog) throw new MusicError("Falta YouTube Music en el servidor. Ejecuta npm run music:setup.", 502)
    if (activeCatalogRequests >= 3) throw new MusicError("Hay varias consultas de música en curso. Espera unos segundos.", 429)
    activeCatalogRequests++
    const promise = Promise.resolve().then(() => catalog(operation, value))
      .catch((error) => { catalogRequests.delete(key); throw error })
      .finally(() => { activeCatalogRequests-- })
    catalogRequests.set(key, { promise, expires: Date.now() + ttl })
    if (catalogRequests.size > 100) catalogRequests.delete(catalogRequests.keys().next().value)
    return promise
  }

  const remember = (track) => {
    const known = metadata.get(track.id) || library.tracks[track.id]?.track
    if (known?.metadataSource === "ytmusic") {
      track = track.metadataSource === "ytmusic" ? { ...known, ...Object.fromEntries(Object.entries(track).filter(([, value]) => value !== undefined)), duration: track.duration || known.duration } : known
    }
    metadata.set(track.id, track)
    if (metadata.size > 300) metadata.delete(metadata.keys().next().value)
    return { ...track, starred: library.likes.track.includes(track.id) }
  }
  const saveTrack = (track) => {
    const previous = library.tracks[track.id]
    // Keep old favourites when a video gains canonical Music album/artist IDs.
    for (const type of ["album", "artist"]) {
      const oldId = previous?.track[`${type}Id`], newId = track[`${type}Id`]
      if (oldId && newId && oldId !== newId && library.likes[type].includes(oldId)) {
        if (!library.likes[type].includes(newId)) library.likes[type].push(newId)
        library.likes[type] = library.likes[type].filter((id) => id !== oldId)
      }
    }
    library.tracks[track.id] = { addedAt: Date.now(), lastPlayed: 0, plays: 0, ...previous, track }
  }
  const tracks = () => Object.values(library.tracks).map((entry) => ({ ...entry.track, starred: library.likes.track.includes(entry.track.id) }))
  const albumFor = (track, songs = [track]) => ({
    id: track.albumId, name: track.album, artist: track.artist, artistId: track.artistId,
    coverArt: track.coverArt, year: track.year, songCount: songs.length, duration: songs.reduce((sum, song) => sum + song.duration, 0),
    tracks: songs, starred: library.likes.album.includes(track.albumId),
  })
  const albums = (type) => {
    const entries = Object.values(library.tracks)
    entries.sort(type === "frequent" ? (a, b) => b.plays - a.plays : type === "recent" ? (a, b) => b.lastPlayed - a.lastPlayed : (a, b) => b.addedAt - a.addedAt)
    const groups = new Map()
    for (const { track } of entries) {
      if (!groups.has(track.albumId)) groups.set(track.albumId, [])
      groups.get(track.albumId).push({ ...track, starred: library.likes.track.includes(track.id) })
    }
    const result = [...groups.values()].map((songs) => albumFor(songs[0], songs))
    if (type === "alphabeticalByName") result.sort((a, b) => a.name.localeCompare(b.name))
    if (type === "random") {
      for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]] }
    }
    return result
  }
  const artists = () => [...new Set(tracks().map((track) => track.artistId))].map((id) => {
    const topTracks = tracks().filter((track) => track.artistId === id)
    const artistAlbums = albums().filter((album) => album.artistId === id)
    return { id, name: topTracks[0].artist, coverArt: topTracks[0].coverArt, albumCount: artistAlbums.length, topTracks, albums: artistAlbums, starred: library.likes.artist.includes(id) }
  })
  const playlist = () => ({ id: "yt-library", name: "Tu música de YouTube", comment: "Tus canciones para escuchar al vuelo", coverArt: tracks()[0]?.coverArt, songCount: tracks().length, duration: tracks().reduce((sum, track) => sum + track.duration, 0), tracks: tracks(), editable: false })
  const userPlaylist = (entry) => {
    const songs = entry.trackIds.map((id) => library.tracks[id]?.track).filter(Boolean).map((track) => ({ ...track, starred: library.likes.track.includes(track.id) }))
    return { id: entry.id, name: entry.name, owner: "Tú", editable: true, coverArt: songs[0]?.coverArt, tracks: songs, songCount: songs.length, duration: songs.reduce((sum, song) => sum + song.duration, 0) }
  }
  const playlists = () => [playlist(), ...library.playlists.map(userPlaylist)]
  const findUserPlaylist = (id) => {
    if (id === "yt-library") throw new MusicError("Elige una lista creada por ti.", 403)
    const entry = library.playlists.find((entry) => entry.id === id)
    if (!entry) throw new MusicError("Lista no encontrada.", 404)
    return entry
  }
  const getTrack = async (id) => {
    const key = `yt:${videoId(id)}`
    if (metadata.has(key)) return metadata.get(key)
    if (library.tracks[key]) return library.tracks[key].track
    return remember(mapCatalogTrack(await fromCatalog("song", videoId(id))))
  }
  const getAlbum = async (id) => {
    if (!id.startsWith("ytm-album:")) return albumFor(await getTrack(id.replace(/^yt-album:/, "")))
    const browseId = catalogId(id, "album")
    const info = await fromCatalog("album", browseId, 30 * 60_000)
    const songs = (info.tracks || []).filter(playableSong).map((song, index) => remember({
      ...mapCatalogTrack({ ...song, album: { name: info.title, id: browseId }, artists: song.artists || info.artists, thumbnails: song.thumbnails || info.thumbnails, year: info.year }), track: index + 1,
    }))
    if (!songs.length) throw new MusicError("Este álbum no tiene canciones disponibles.", 404)
    return { ...albumFor(songs[0], songs), coverArt: thumbnail(info.thumbnails) || songs[0].coverArt }
  }
  const getArtist = async (id) => {
    if (typeof id !== "string" || !id.startsWith("ytm-artist:")) {
      const artist = artists().find((artist) => artist.id === id)
      if (!artist) throw new MusicError("Artista no encontrado en tu biblioteca.", 404)
      return artist
    }
    const channelId = catalogId(id, "artist")
    const info = await fromCatalog("artist", channelId, 30 * 60_000)
    const artistAlbums = [...(info.albums?.results || []), ...(info.singles?.results || [])].filter((album) => album.browseId).map((album) => ({
      id: `ytm-album:${album.browseId}`, name: album.title, artist: info.name, artistId: id,
      coverArt: thumbnail(album.thumbnails), year: Number(album.year) || undefined,
      songCount: 0, duration: 0, starred: library.likes.album.includes(`ytm-album:${album.browseId}`),
    }))
    const topTracks = (info.songs?.results || []).filter(playableSong).map((song) => remember(mapCatalogTrack({ ...song, artists: song.artists || [{ name: info.name, id: channelId }] })))
    return { id, name: info.name, coverArt: thumbnail(info.thumbnails), albumCount: artistAlbums.length, albums: artistAlbums, topTracks, starred: library.likes.artist.includes(id) }
  }
  const mapArtists = (rows, limit, excludedId) => {
    const seen = new Set(excludedId ? [excludedId] : [])
    return (Array.isArray(rows) ? rows : []).map(mapCatalogArtist).filter((artist) => {
      if (!artist || seen.has(artist.id)) return false
      seen.add(artist.id)
      artist.starred = library.likes.artist.includes(artist.id)
      return true
    }).slice(0, limit)
  }
  const resolveAudio = (id, { refresh = false, background = false } = {}) => {
    if (refresh) streamCache.delete(id)
    const cached = streamCache.get(id)
    if (cached && cached.expires > Date.now()) return Promise.resolve(cached.stream)
    streamCache.delete(id)
    if (streams.has(id)) return streams.get(id)
    // Reserve capacity for playback even while a likely next song is being prepared.
    if (streams.size >= (background ? 1 : 3)) throw new MusicError("Hay varias canciones preparándose. Espera unos segundos.", 429)
    const extract = (direct) => run([
      "--dump-single-json", "--skip-download",
      "--format", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio[ext=mp3]/bestaudio[ext=ogg]/bestaudio[ext=opus]",
      ...(direct ? ["--extractor-args", "youtube:skip=hls"] : []),
      "--", `https://www.youtube.com/watch?v=${id}`,
    ])
    // Direct audio avoids fetching an unused HLS manifest. A missing audio format
    // falls back to full extraction; explicit/media-error refreshes always use it.
    const promise = extract(!refresh).catch((error) => {
      if (!refresh && /Requested format is not available|No video formats found|Only images are available/i.test(error.message)) return extract(false)
      throw error
    }).then((output) => {
      const info = JSON.parse(output)
      if (videoId(info.id) !== id || info.is_live || !info.url || !/^https:\/\//.test(info.url)) {
        throw new MusicError("No se ha encontrado una URL de audio para esta canción.", 502)
      }
      const stream = { url: info.url, track: mapTrack(info) }
      // Only cache signed URLs with a known expiry, and leave a full minute of margin.
      const expires = Math.min(Date.now() + 5 * 60_000, Number(new URL(info.url).searchParams.get("expire")) * 1000 - 60_000)
      if (expires > Date.now()) {
        streamCache.set(id, { stream, expires })
        if (streamCache.size > 100) streamCache.delete(streamCache.keys().next().value)
      }
      return stream
    }).finally(() => streams.delete(id))
    streams.set(id, promise)
    return promise
  }
  return {
    async health() {
      const [version, source] = await Promise.all([run(["--version"], 15_000), fromCatalog("health", "", 60_000)])
      return { ok: true, version, catalog: source, tracks: tracks().length }
    },
    async search(query, type = "all") {
      if (!["all", "tracks", "albums", "artists"].includes(type)) throw new MusicError("Tipo de búsqueda no válido.")
      const { target, flat } = searchTarget(query)
      const text = target.slice("ytsearch12:".length)
      const [result, albumResults, artistResults] = flat ? await Promise.all([
        ["all", "tracks"].includes(type) ? fromCatalog("search", text, 60_000) : [],
        ["all", "albums"].includes(type) ? fromCatalog("searchAlbums", text, 60_000) : [],
        ["all", "artists"].includes(type) ? fromCatalog("searchArtists", text, 60_000) : [],
      ]) : [type === "artists" ? [] : [await fromCatalog("song", new URL(target).searchParams.get("v"))], [], []]
      const seen = new Set()
      const songs = result.filter((song) => {
        if (!playableSong(song) || seen.has(song.videoId)) return false
        seen.add(song.videoId); return true
      }).map((song) => remember(mapCatalogTrack(song)))
      const seenAlbums = new Set()
      const foundAlbums = albumResults.map(mapCatalogAlbum).filter((album) => {
        if (!album || seenAlbums.has(album.id)) return false
        seenAlbums.add(album.id)
        album.starred = library.likes.album.includes(album.id)
        return true
      })
      return { artists: mapArtists(artistResults, type === "all" ? 8 : 20), albums: foundAlbums, tracks: ["albums", "artists"].includes(type) ? [] : songs }
    },
    async artistRecommendations(value) {
      const id = catalogId(value, "artist")
      const info = await fromCatalog("artist", id, 30 * 60_000)
      const related = mapArtists(info.related?.results, 20, value)
      const playlistId = (candidate) => typeof candidate === "string" && /^[a-zA-Z0-9_-]{10,200}$/.test(candidate) ? candidate : undefined
      const songsId = playlistId(info.songs?.browseId), radioId = playlistId(info.radioId) || playlistId(info.shuffleId)
      const releaseIds = (section) => [...new Set((section?.results || []).map((release) => release?.browseId)
        .filter((browseId) => typeof browseId === "string" && /^[a-zA-Z0-9_-]{10,100}$/.test(browseId)))].slice(0, 3)
      const releases = [...new Set([...releaseIds(info.albums), ...releaseIds(info.singles)])]
      const requests = [
        ...(songsId ? [["artistSongs", songsId]] : []),
        ...(radioId ? [["artistRadio", radioId]] : []),
        ...releases.map((browseId) => ["album", browseId]),
      ]
      const sources = new Map()
      // At most three catalogue jobs at a time; matching concurrent requests share them.
      // Keep successful sources cached, but retry failed sources on the next request.
      for (let i = 0; i < requests.length; i += 3) {
        await Promise.all(requests.slice(i, i + 3).map(async ([operation, browseId]) => {
          try { sources.set(`${operation}:${browseId}`, await fromCatalog(operation, browseId, 30 * 60_000)) }
          catch { /* An unavailable release/playlist must not discard the other sources. */ }
        }))
      }
      const seen = new Set((info.songs?.results || []).map((song) => song?.videoId).filter(Boolean))
      const take = (rows, limit) => {
        const found = []
        for (const song of rows) {
          if (found.length === limit) break
          // Names alone, playlist membership and album ownership do not prove a credit.
          if (!playableSong(song) || seen.has(song.videoId) || !song.artists?.some((credit) => credit?.id === id && typeof credit.name === "string" && credit.name.trim())) continue
          const track = mapCatalogTrack(song)
          seen.add(song.videoId)
          // Existing saved metadata can lack the new credits; return the verified credits.
          found.push({ ...remember(track), artist: track.artist, artistId: track.artistId, artists: track.artists })
        }
        return found
      }
      const songs = sources.get(`artistSongs:${songsId}`)?.tracks || []
      const radio = sources.get(`artistRadio:${radioId}`)?.tracks || []
      const tracks = take([...songs.slice(0, 100), ...radio], 40)
      const deepCuts = take(releases.flatMap((browseId) => {
        const album = sources.get(`album:${browseId}`)
        return (album?.tracks || []).map((song) => ({ ...song, artists: song.artists || album.artists, album: { name: album.title, id: browseId }, thumbnails: song.thumbnails || album.thumbnails, year: album.year }))
      }), 15)
      return { tracks, deepCuts, artists: related }
    },
    async recommendations(value) {
      const id = videoId(value)
      const info = await fromCatalog("recommendations", id)
      const seen = new Set([id])
      return (info.tracks || []).filter((song) => {
        if (!playableSong(song) || seen.has(song.videoId)) return false
        seen.add(song.videoId); return true
      }).slice(0, 20).map((song) => remember(mapCatalogTrack(song)))
    },
    async home() {
      try {
        // One shared catalogue request per 15 min, independent of profiles or library size.
        const discovery = mapHomeAlbums(await fromCatalog("home", "", 15 * 60_000))
        if (discovery.newest.length || discovery.random.length) lastDiscovery = discovery
        else catalogRequests.delete("home:")
      } catch { /* Existing library and last good discovery remain usable during an outage. */ }
      const merge = (first, second) => {
        const unique = new Map()
        for (const album of [...first, ...second]) if (!unique.has(album.id)) unique.set(album.id, { ...album, starred: library.likes.album.includes(album.id) })
        return [...unique.values()].slice(0, 12)
      }
      return {
        recent: albums("recent").slice(0, 12), newest: merge(albums("newest"), lastDiscovery.newest),
        frequent: albums("frequent").filter((album) => library.tracks[album.tracks[0].id].plays > 0).slice(0, 12),
        random: merge(lastDiscovery.random, albums("random")), artists: artists().slice(0, 12), playlists: playlists(),
      }
    },
    albums, artists,
    album: getAlbum,
    artist: getArtist,
    playlists,
    playlist(id) { return id === "yt-library" ? playlist() : userPlaylist(findUserPlaylist(id)) },
    async createPlaylist(name, id) {
      const title = typeof name === "string" ? name.trim() : ""
      if (!title || title.length > 80 || /[\u0000-\u001f\u007f]/.test(title)) throw new MusicError("Pon un nombre de entre 1 y 80 caracteres a la lista.")
      const track = id === undefined ? undefined : await getTrack(id)
      const entry = { id: `user-list:${randomUUID()}`, name: title, trackIds: track ? [track.id] : [] }
      if (track) saveTrack(track)
      library.playlists.push(entry)
      await persist()
      return userPlaylist(entry)
    },
    async addToPlaylist(id, trackId) {
      const entry = findUserPlaylist(id)
      const track = await getTrack(trackId)
      if (!entry.trackIds.includes(track.id)) {
        saveTrack(track)
        entry.trackIds.push(track.id)
        await persist()
      }
      return userPlaylist(entry)
    },
    starred() { return { tracks: tracks().filter((track) => track.starred), albums: albums().filter((album) => album.starred), artists: artists().filter((artist) => artist.starred) } },
    async star(id, type, value) {
      if (!["track", "album", "artist"].includes(type)) throw new MusicError("Tipo de favorito no válido.")
      // Removing a favourite must also work while the remote catalogue is unavailable.
      if (!value) {
        if (typeof id !== "string") throw new MusicError("Identificador de favorito no válido.")
        if (type === "track") id = `yt:${videoId(id)}`
        library.likes[type] = library.likes[type].filter((liked) => liked !== id)
        await persist()
        return
      }
      if (type === "track") {
        // Favourites keep their metadata even before the first playback.
        const track = await getTrack(id)
        saveTrack(track)
        id = track.id
      } else if (type === "album") {
        const album = await getAlbum(id)
        album.tracks.forEach(saveTrack)
        id = album.id
      } else {
        const artist = await getArtist(id)
        if (!artist.topTracks.length) throw new MusicError("Este artista no tiene canciones disponibles.", 404)
        artist.topTracks.forEach(saveTrack)
      }
      if (!library.likes[type].includes(id)) library.likes[type].push(id)
      await persist()
    },
    async scrobble(id, submission) {
      const entry = library.tracks[`yt:${videoId(id)}`]
      if (entry) { entry.lastPlayed = Date.now(); if (submission) entry.plays++; await persist() }
    },
    async prepare(id) {
      await resolveAudio(videoId(id), { background: true })
      return { ok: true }
    },
    async stream(id, { refresh = false } = {}) {
      id = videoId(id)
      const stream = await resolveAudio(id, { refresh })
      const known = metadata.get(`yt:${id}`) || library.tracks[`yt:${id}`]?.track
      // Preparation stays in RAM; only an actual playback becomes part of the library.
      const track = remember(known?.metadataSource === "ytmusic" ? known : stream.track)
      saveTrack(track)
      await persist()
      return { url: stream.url, track }
    },
  }
}
