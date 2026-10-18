import { createHash } from "node:crypto"
import { createPodcastHttp, podcastUrl, readPodcastBody } from "./podcast-http.mjs"
import { parsePodcastFeed } from "./podcast-feed.mjs"
import { createPodcastCharts } from "./podcast-charts.mjs"
import { MusicError } from "./errors.mjs"
import { transaction } from "./db.mjs"

const hash = (value) => createHash("sha256").update(value).digest("hex")
const text = (value, limit = 8000) => String(value ?? "").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, limit)
const safeUrl = (value, base) => { try { return value ? podcastUrl(value, base) : undefined } catch { return undefined } }
const fold = (value) => String(value).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
const defaultProgress = (episode) => ({ episodeId: episode.id, position: 0, duration: episode.duration, completed: false, resumePosition: 0, revision: 0, updatedAt: null })
const upstreamError = (error) => error instanceof MusicError ? error : new MusicError(error?.name === "TimeoutError" || error?.name === "AbortError" ? "El proveedor de podcasts ha tardado demasiado." : "No se puede conectar con el proveedor de podcasts.", error?.name === "TimeoutError" || error?.name === "AbortError" ? 504 : 502)
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"])

/** Some RSS image hosts (including COPE's S3) label raster images as generic binary. */
function rasterMime(body) {
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return "image/jpeg"
  if (body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png"
  if (["GIF87a", "GIF89a"].includes(body.toString("ascii", 0, 6))) return "image/gif"
  if (body.length >= 12 && body.toString("ascii", 0, 4) === "RIFF" && body.toString("ascii", 8, 12) === "WEBP") return "image/webp"
  if (body.length >= 16 && body.toString("ascii", 4, 8) === "ftyp" && ["avif", "avis"].includes(body.toString("ascii", 8, 12))) return "image/avif"
  return null
}

export function podcastInteger(value, fallback, min = 1, max = 100) {
  if (value === null || value === undefined) return fallback
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new MusicError(`Se requiere un entero entre ${min} y ${max}.`)
  return Number(value)
}

export function createPodcastService({ db, request = createPodcastHttp(), parseFeed = parsePodcastFeed, now = Date.now } = {}) {
  const searchCache = new Map(), pending = new Map(), directoryCalls = [], images = new Map()
  let imageBytes = 0
  const showRow = (id) => db.prepare("SELECT * FROM podcast_shows WHERE id = ?").get(id)
  const episodeRow = (id) => db.prepare("SELECT * FROM podcast_episodes WHERE id = ?").get(id)
  const episode = (id) => { if (typeof id !== "string" || !/^episode:[a-f0-9]{40}$/.test(id)) throw new MusicError("Identificador de episodio no válido."); const row = episodeRow(id); if (!row) throw new MusicError("Episodio no encontrado.", 404); return JSON.parse(row.metadata_json) }
  const show = (id) => { const row = showRow(id); if (!row) throw new MusicError("Podcast no encontrado.", 404); return JSON.parse(row.metadata_json) }

  function saveShow(value) {
    const feedUrl = podcastUrl(value.feedUrl)
    const id = `podcast:${hash(feedUrl).slice(0, 32)}`
    const previous = showRow(id)
    const old = previous ? JSON.parse(previous.metadata_json) : {}
    const data = { title: "Podcast", author: "", description: "", ...old, ...Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== "")), id, feedUrl }
    db.prepare("INSERT INTO podcast_shows(id, feed_url, metadata_json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET metadata_json = excluded.metadata_json").run(id, feedUrl, JSON.stringify(data))
    return data
  }
  function saveEpisode(podcast, value, preferExisting = false) {
    const enclosureUrl = podcastUrl(value.enclosureUrl, podcast.feedUrl)
    const id = `episode:${hash(`${podcast.id}\0${value.guid || enclosureUrl}`).slice(0, 40)}`
    if (preferExisting) { const existing = episodeRow(id); if (existing) return JSON.parse(existing.metadata_json) }
    const publishedAt = Number.isFinite(Date.parse(value.publishedAt)) ? new Date(value.publishedAt).toISOString() : null
    const data = { id, podcastId: podcast.id, podcastTitle: podcast.title, title: text(value.title, 500) || "Episodio", description: text(value.description), author: text(value.author || podcast.author, 500), coverArt: safeUrl(value.image, podcast.feedUrl) || podcast.coverArt, enclosureUrl, mimeType: value.mimeType || "audio/mpeg", duration: Number.isFinite(value.duration) && value.duration >= 0 ? Math.min(value.duration, 2592000) : 0, publishedAt, explicit: !!value.explicit }
    // A GUID survives enclosure URL changes; existing progress therefore survives refreshes.
    db.prepare("INSERT INTO podcast_episodes(id, podcast_id, metadata_json, published_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET metadata_json = excluded.metadata_json, published_at = excluded.published_at").run(id, podcast.id, JSON.stringify(data), publishedAt ? Date.parse(publishedAt) : 0)
    return data
  }
  function progress(userId, value) {
    const row = db.prepare("SELECT * FROM podcast_progress WHERE user_id = ? AND episode_id = ?").get(userId, value.id)
    return row ? { episodeId: value.id, position: row.position, duration: row.duration, completed: !!row.completed, resumePosition: row.completed ? 0 : row.position, revision: row.revision, updatedAt: row.updated_at } : defaultProgress(value)
  }
  const forUser = (userId, value) => ({ ...value, progress: progress(userId, value) })
  const following = (userId, id) => !!db.prepare("SELECT 1 FROM podcast_follows WHERE user_id = ? AND podcast_id = ?").get(userId, id)

  async function shared(key, work) {
    if (pending.has(key)) return pending.get(key)
    if (pending.size >= 8) throw new MusicError("El catálogo de podcasts está ocupado. Vuelve a intentarlo.", 503)
    const promise = work().finally(() => pending.delete(key))
    pending.set(key, promise)
    return promise
  }
  async function apple(query, entity, country, limit) {
    const url = new URL("https://itunes.apple.com/search")
    url.search = new URLSearchParams({ term: query, media: "podcast", entity, country, limit: String(limit) }).toString()
    const key = url.href
    const hit = searchCache.get(key)
    if (hit?.expires > now()) return hit.results
    return shared(key, async () => {
      while (directoryCalls.length && directoryCalls[0] <= now() - 60_000) directoryCalls.shift()
      if (directoryCalls.length >= 18) throw Object.assign(new MusicError("Límite temporal del buscador de podcasts. Prueba dentro de un minuto.", 429), { retryAfter: Math.max(1, Math.ceil((directoryCalls[0] + 60_000 - now()) / 1000)) })
      directoryCalls.push(now())
      try {
        const response = await request(key, { signal: AbortSignal.timeout(6500), headers: { Accept: "application/json" } })
        if (response.status !== 200) { response.body.destroy(); throw new MusicError("El buscador de podcasts no está disponible.", response.status === 429 ? 429 : 502) }
        const data = JSON.parse((await readPodcastBody(response, 4 * 1024 * 1024)).toString("utf8"))
        if (!Array.isArray(data.results)) throw new MusicError("Respuesta del buscador de podcasts no válida.", 502)
        if (searchCache.size >= 100) searchCache.delete(searchCache.keys().next().value)
        searchCache.set(key, { results: data.results, expires: now() + 5 * 60_000 })
        return data.results
      } catch (error) { throw upstreamError(error) }
    })
  }
  function fromApple(row) {
    const feedUrl = safeUrl(row.feedUrl)
    if (!feedUrl) return null
    const known = db.prepare("SELECT metadata_json, refreshed_at FROM podcast_shows WHERE feed_url = ?").get(feedUrl)
    if (known?.refreshed_at) return JSON.parse(known.metadata_json)
    return saveShow({ feedUrl, title: text(row.collectionName || row.trackName, 500), author: text(row.artistName, 500), coverArt: safeUrl(row.artworkUrl600 || row.artworkUrl100), appleUrl: safeUrl(row.collectionViewUrl), description: "" })
  }

  const getTop = createPodcastCharts({ request, now, saveShows: (rows) => transaction(db, () => rows.map(fromApple)) })

  async function refreshShow(id) {
    if (typeof id !== "string" || !/^podcast:[a-f0-9]{32}$/.test(id)) throw new MusicError("Identificador de podcast no válido.")
    const row = showRow(id)
    if (!row) throw new MusicError("Podcast no encontrado.", 404)
    if (row.refreshed_at && now() - row.refreshed_at < 10 * 60_000) return false
    return shared(`feed:${id}`, async () => {
      try {
        const response = await request(row.feed_url, { signal: AbortSignal.timeout(6500), headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml", ...(row.etag ? { "If-None-Match": row.etag } : {}), ...(row.last_modified ? { "If-Modified-Since": row.last_modified } : {}) } })
        if (response.status === 304 && row.refreshed_at) { response.body.destroy(); db.prepare("UPDATE podcast_shows SET refreshed_at = ? WHERE id = ?").run(now(), id); return false }
        if (response.status !== 200) { response.body.destroy(); throw new MusicError("El feed del podcast no está disponible.", 502) }
        const parsed = await parseFeed(await readPodcastBody(response))
        transaction(db, () => {
          const podcast = saveShow({ ...JSON.parse(row.metadata_json), title: text(parsed.title, 500), author: text(parsed.author, 500), description: text(parsed.description), coverArt: safeUrl(parsed.image, response.url) || JSON.parse(row.metadata_json).coverArt, language: text(parsed.language, 50) })
          for (const entry of parsed.episodes) {
            const url = safeUrl(entry.enclosureUrl, response.url)
            if (url) saveEpisode(podcast, { ...entry, enclosureUrl: url, image: safeUrl(entry.image, response.url) })
          }
          db.prepare("UPDATE podcast_shows SET refreshed_at = ?, etag = ?, last_modified = ? WHERE id = ?").run(now(), String(response.headers.etag || "").slice(0, 1000) || null, String(response.headers["last-modified"] || "").slice(0, 1000) || null, id)
        })
        return false
      } catch (error) {
        if (row.refreshed_at) return true // The last valid feed remains usable during an outage.
        throw upstreamError(error)
      }
    })
  }

  return {
    getTop,
    async search(userId, { q, kind = "all", country = "ES", limit = 20 }) {
      if (typeof q !== "string" || !q.trim() || q.trim().length > 200) throw new MusicError("La búsqueda debe tener entre 1 y 200 caracteres.")
      if (!["all", "podcasts", "episodes"].includes(kind)) throw new MusicError("Tipo de búsqueda no válido.")
      if (!/^[A-Za-z]{2}$/.test(country)) throw new MusicError("País no válido (código de dos letras).")
      limit = podcastInteger(limit, 20, 1, 50)
      const [shows, entries] = await Promise.all([kind === "episodes" ? [] : apple(q.trim(), "podcast", country.toUpperCase(), limit), kind === "podcasts" ? [] : apple(q.trim(), "podcastEpisode", country.toUpperCase(), limit)])
      const podcasts = [], episodes = []
      transaction(db, () => {
        for (const row of shows) { const value = fromApple(row); if (value && !podcasts.some((p) => p.id === value.id)) podcasts.push(value) }
        for (const row of entries) {
          if (!row.episodeUrl || (row.episodeContentType && row.episodeContentType !== "audio") || !safeUrl(row.episodeUrl)) continue
          const podcast = fromApple(row)
          if (!podcast) continue
          const value = saveEpisode(podcast, { guid: row.episodeGuid, title: row.trackName, description: row.description || row.shortDescription, image: row.artworkUrl600, enclosureUrl: row.episodeUrl, mimeType: row.episodeFileExtension === "m4a" ? "audio/mp4" : "audio/mpeg", duration: Number(row.trackTimeMillis || 0) / 1000, publishedAt: row.releaseDate, explicit: String(row.contentAdvisoryRating).toLowerCase() === "explicit" }, true)
          if (!episodes.some((e) => e.id === value.id)) episodes.push(forUser(userId, value))
        }
      })
      return { source: "itunes-rss", podcasts, episodes }
    },
    async importFeed(userId, url) {
      const feedUrl = podcastUrl(url)
      const existing = db.prepare("SELECT id FROM podcast_shows WHERE feed_url = ?").get(feedUrl)
      const podcast = existing ? show(existing.id) : saveShow({ feedUrl })
      return this.getShow(userId, podcast.id, {})
    },
    async getShow(userId, id, { q = "", limit = 50, offset = 0 } = {}) {
      limit = podcastInteger(limit, 50, 1, 100); offset = podcastInteger(offset, 0, 0, 100000)
      if (typeof q !== "string" || q.length > 200) throw new MusicError("Búsqueda de episodios no válida.")
      const stale = await refreshShow(id)
      const entries = db.prepare("SELECT metadata_json FROM podcast_episodes WHERE podcast_id = ? ORDER BY published_at DESC, id").all(id).map((row) => JSON.parse(row.metadata_json)).filter((e) => !q || fold(`${e.title} ${e.description}`).includes(fold(q)))
      return { podcast: show(id), episodes: entries.slice(offset, offset + limit).map((e) => forUser(userId, e)), total: entries.length, limit, offset, stale, following: following(userId, id) }
    },
    getFollows(userId) {
      const rows = db.prepare("SELECT s.metadata_json, f.followed_at FROM podcast_follows f JOIN podcast_shows s ON s.id = f.podcast_id WHERE f.user_id = ? ORDER BY f.followed_at DESC, f.podcast_id").all(userId)
      return { podcasts: rows.map((row) => ({ ...JSON.parse(row.metadata_json), followedAt: row.followed_at })) }
    },
    setFollowing(userId, id, follow) {
      if (typeof id !== "string" || !/^podcast:[a-f0-9]{32}$/.test(id)) throw new MusicError("Identificador de podcast no válido.")
      if (follow) {
        show(id) // Following requires a registered show; no remote request is needed.
        db.prepare("INSERT INTO podcast_follows(user_id, podcast_id, followed_at) VALUES (?, ?, ?) ON CONFLICT(user_id, podcast_id) DO NOTHING").run(userId, id, now())
      } else db.prepare("DELETE FROM podcast_follows WHERE user_id = ? AND podcast_id = ?").run(userId, id)
      return { following: follow }
    },
    getEpisode: (userId, id) => forUser(userId, episode(id)),
    getProgress: (userId, id) => progress(userId, episode(id)),
    saveProgress(userId, id, body) {
      if (!body || typeof body !== "object" || Array.isArray(body) || !["position", "duration", "completed"].some((key) => key in body) || Object.keys(body).some((key) => !["position", "duration", "completed", "expectedRevision"].includes(key))) throw new MusicError("Actualización de progreso no válida.")
      for (const key of ["position", "duration"]) if (body[key] !== undefined && (typeof body[key] !== "number" || !Number.isFinite(body[key]) || body[key] < 0 || body[key] > 2592000)) throw new MusicError("Posición o duración no válida (segundos).")
      if (body.completed !== undefined && typeof body.completed !== "boolean") throw new MusicError("El estado escuchado debe ser booleano.")
      if (body.expectedRevision !== undefined && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)) throw new MusicError("Revisión de progreso no válida.")
      const value = episode(id)
      return transaction(db, () => {
        const previous = progress(userId, value)
        if (body.expectedRevision !== undefined && body.expectedRevision !== previous.revision) throw new MusicError("El progreso ha cambiado en otro dispositivo. Vuelve a cargarlo.", 409)
        const duration = body.duration ?? previous.duration
        const position = Math.min(body.position ?? previous.position, duration || Infinity)
        db.prepare("INSERT INTO podcast_progress(user_id, episode_id, position, duration, completed, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, episode_id) DO UPDATE SET position = excluded.position, duration = excluded.duration, completed = excluded.completed, revision = excluded.revision, updated_at = excluded.updated_at").run(userId, id, position, duration, (body.completed ?? previous.completed) ? 1 : 0, previous.revision + 1, now())
        return progress(userId, value)
      })
    },
    listProgress(userId, { limit = 50, offset = 0, completed } = {}) {
      limit = podcastInteger(limit, 50, 1, 100); offset = podcastInteger(offset, 0, 0, 100000)
      if (completed !== undefined && completed !== "true" && completed !== "false") throw new MusicError("Filtro escuchado no válido.")
      const where = "user_id = ?" + (completed === undefined ? "" : " AND completed = ?")
      const args = completed === undefined ? [userId] : [userId, completed === "true" ? 1 : 0]
      const total = db.prepare(`SELECT COUNT(*) AS n FROM podcast_progress WHERE ${where}`).get(...args).n
      const rows = db.prepare(`SELECT episode_id FROM podcast_progress WHERE ${where} ORDER BY updated_at DESC, episode_id LIMIT ? OFFSET ?`).all(...args, limit, offset)
      return { episodes: rows.map((row) => forUser(userId, episode(row.episode_id))), total, limit, offset }
    },
    getStream(userId, id) {
      const value = episode(id)
      return { url: value.enclosureUrl, proxyPath: `/api/podcasts/audio?id=${encodeURIComponent(id)}`, mimeType: value.mimeType, episode: forUser(userId, value), resumePosition: progress(userId, value).resumePosition }
    },
    async getArtwork(id) {
      if (typeof id !== "string") throw new MusicError("Identificador de portada no válido.")
      const value = id.startsWith("episode:") ? episode(id) : show(id)
      if (!value.coverArt) throw new MusicError("Este podcast no tiene portada.", 404)
      const hit = images.get(value.coverArt)
      if (hit?.expires > now()) return hit
      return shared(`image:${value.coverArt}`, async () => {
        try {
          const response = await request(value.coverArt, { signal: AbortSignal.timeout(6500), headers: { Accept: "image/*" } })
          let mimeType = String(response.headers["content-type"] || "").split(";")[0].trim().toLowerCase()
          const generic = ["", "application/octet-stream", "binary/octet-stream"].includes(mimeType)
          if (response.status !== 200 || (!generic && !IMAGE_TYPES.has(mimeType))) { response.body.destroy(); throw new MusicError("Portada de podcast no disponible.", 502) }
          const body = await readPodcastBody(response, 5 * 1024 * 1024)
          if (!body.length) throw new MusicError("Portada de podcast vacía.", 502)
          if (generic) mimeType = rasterMime(body)
          if (!mimeType) throw new MusicError("La portada del podcast no contiene una imagen compatible.", 502)
          if (images.has(value.coverArt)) { imageBytes -= images.get(value.coverArt).body.length; images.delete(value.coverArt) }
          while (images.size && (imageBytes + body.length > 32 * 1024 * 1024 || images.size >= 64)) { const key = images.keys().next().value; imageBytes -= images.get(key).body.length; images.delete(key) }
          const image = { body, mimeType, expires: now() + 60 * 60_000 }
          images.set(value.coverArt, image); imageBytes += body.length
          return image
        } catch (error) { throw upstreamError(error) }
      })
    },
    async openAudio(id, { method, range, ifRange, signal }) {
      const value = episode(id)
      if (range && (!/^bytes=(?:\d+-\d*|-\d+)$/.test(range) || range.length > 100)) throw new MusicError("Se admite un único rango de bytes.", 400)
      try {
        const response = await request(value.enclosureUrl, { method, signal, headers: { Accept: "audio/*, application/octet-stream", ...(range ? { Range: range } : {}), ...(range && ifRange ? { "If-Range": ifRange } : {}) } })
        if (![200, 206, 416].includes(response.status)) { response.body.destroy(); throw new MusicError("El audio del episodio no está disponible.", response.status === 404 || response.status === 410 ? 404 : 502) }
        if ((response.status !== 416 && response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") || (response.status === 206 && !/^bytes \d+-\d+\/(?:\d+|\*)$/.test(response.headers["content-range"] || ""))) { response.body.destroy(); throw new MusicError("Respuesta de audio con rango o codificación no válida.", 502) }
        const mime = String(response.headers["content-type"] || value.mimeType).split(";")[0].toLowerCase()
        if (response.status !== 416 && !mime.startsWith("audio/") && mime !== "application/octet-stream") { response.body.destroy(); throw new MusicError("El servidor del episodio no devolvió audio.", 502) }
        return response
      } catch (error) { throw upstreamError(error) }
    },
  }
}
