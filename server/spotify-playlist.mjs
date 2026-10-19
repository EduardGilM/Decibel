import { MusicError } from "./errors.mjs"

const OPEN = "https://open.spotify.com"
const PLAYLIST_API = "https://spclient.wg.spotify.com/playlist/v2/playlist"
const MAX_TRACKS = 5000
const MAX_RESPONSE = 4_000_000
const invalid = () => new MusicError("Pega el enlace de una lista de Spotify.")
const incomplete = () => new MusicError("No se ha podido leer la lista completa de Spotify. Comprueba que sea pública y vuelve a intentarlo.", 502)

/** Canonical playlist URLs and Spotify's own short links only; never fetch an arbitrary user URL. */
export function spotifyPlaylistLink(value) {
  if (typeof value !== "string" || value.length > 2048) throw invalid()
  const text = value.trim()
  const uri = /^spotify:playlist:([A-Za-z0-9]{22})$/.exec(text)
  if (uri) return `${OPEN}/playlist/${uri[1]}`
  let url
  try { url = new URL(text) } catch { throw invalid() }
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw invalid()
  if (url.hostname === "spotify.link" && /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return url.origin + url.pathname
  if (url.origin !== OPEN) throw invalid()
  const id = /^\/(?:intl-[a-z-]+\/)?(?:embed\/|user\/[^/]+\/)?playlist\/([A-Za-z0-9]{22})\/?$/i.exec(url.pathname)?.[1]
  if (!id) throw invalid()
  return `${OPEN}/playlist/${id}`
}

function embedded(html) {
  const json = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1]
  try {
    const state = JSON.parse(json).props.pageProps.state
    if (state?.data?.entity) return state
  } catch {}
  throw incomplete()
}

function trackInfo(entity, uri) {
  if (!entity || typeof uri !== "string" || !/^spotify:track:[A-Za-z0-9]{22}$/.test(uri) || entity.uri !== uri) return null
  const title = entity.title ?? entity.name
  const credit = typeof entity.subtitle === "string" ? entity.subtitle.trim() : ""
  // Keep the whole credit as well: a band's name can itself contain a comma.
  const artists = Array.isArray(entity.artists) ? entity.artists.map((a) => a?.name) : [...credit.split(/,\s*/), credit]
  const names = [...new Set(artists.filter((a) => typeof a === "string" && a.trim()).map((a) => a.trim()))]
  if (typeof title !== "string" || !title.trim() || !names.length) return null
  return { id: uri.slice("spotify:track:".length), title: title.trim(), artists: names, duration: Number(entity.duration) > 0 ? Number(entity.duration) / 1000 : 0 }
}

/**
 * Public metadata only. The embed supplies the name, the first tracks and its anonymous session.
 * The playlist endpoint supplies the full, paginated order; embed pages fill in any remaining titles.
 * Never fall back to the embed's first 100 songs when the full read fails.
 */
export async function readSpotifyPlaylist(link, { fetch = globalThis.fetch, wait = (ms) => new Promise((done) => setTimeout(done, ms)), progress = () => {} } = {}) {
  async function request(url, token, allowRedirect = false) {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, {
        redirect: "manual",
        headers: token ? { Accept: "application/json", Authorization: `Bearer ${token}` } : { Accept: "text/html" },
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null)
      if (response?.ok || (allowRedirect && [301, 302, 303, 307, 308].includes(response?.status))) return response
      const status = response?.status ?? 0
      const delay = Number(response?.headers.get("retry-after")) || 2 ** attempt
      await response?.body?.cancel()
      if (attempt < 2 && delay <= 30 && (!status || status === 429 || status >= 500)) { await wait(Math.max(1, delay) * 1000); continue }
      const error = new MusicError(
        status === 404 || status === 410 ? "No se encuentra esta lista o canción pública de Spotify."
          : status === 429 ? "Spotify ha limitado las peticiones. Inténtalo más tarde."
            : "Spotify no permite leer la lista completa ahora. Comprueba que sea pública y vuelve a intentarlo.", 502)
      error.spotifyStatus = status
      throw error
    }
  }

  async function text(response) {
    const chunks = []
    let size = 0
    try {
      for await (const chunk of response.body) {
        if ((size += chunk.length) > MAX_RESPONSE) throw incomplete()
        chunks.push(chunk)
      }
    } catch (error) {
      if (error instanceof MusicError) throw error
      throw incomplete()
    }
    return Buffer.concat(chunks).toString("utf8")
  }

  let url = spotifyPlaylistLink(link)
  for (let redirects = 0; new URL(url).hostname === "spotify.link"; redirects++) {
    if (redirects >= 3) throw invalid()
    const response = await request(url, undefined, true)
    const location = response.headers.get("location")
    await response.body?.cancel()
    if (!location || response.ok) throw invalid()
    url = spotifyPlaylistLink(new URL(location, url).href)
  }
  const id = url.split("/").pop()
  const state = embedded(await text(await request(`${OPEN}/embed/playlist/${id}`)))
  const entity = state.data.entity
  if (entity.type !== "playlist" || entity.uri !== `spotify:playlist:${id}`) throw incomplete()
  const token = state.settings?.session?.accessToken
  if (typeof token !== "string" || !token || token.length > 8192) throw incomplete()

  const items = []
  let total, revision, name
  do {
    const response = await request(`${PLAYLIST_API}/${id}?fields=contents,attributes&from=${items.length}&length=500`, token)
    let page
    try { page = JSON.parse(await text(response)) } catch { throw incomplete() }
    if (!Number.isInteger(page?.length) || page.length < 0 || !Array.isArray(page.contents?.items) || page.contents.pos !== items.length || typeof page.revision !== "string") throw incomplete()
    if (total === undefined) {
      total = page.length
      revision = page.revision
      name = page.attributes?.name ?? entity.name ?? entity.title
      if (total > MAX_TRACKS) throw new MusicError(`La lista supera el límite de ${MAX_TRACKS} canciones.`)
      if (!total) throw new MusicError("Esta lista está vacía.")
    }
    // A list edited while paging must be retried, otherwise positions could be lost or repeated.
    if (page.length !== total || page.revision !== revision) throw new MusicError("La lista ha cambiado mientras se leía. Vuelve a importarla.")
    if (!page.contents.items.length || items.length + page.contents.items.length > total) throw incomplete()
    items.push(...page.contents.items)
    if (items.length < total && page.contents.truncated === false) throw incomplete()
  } while (items.length < total)

  const known = new Map()
  for (const entry of Array.isArray(entity.trackList) ? entity.trackList : []) {
    const track = trackInfo(entry, entry?.uri)
    if (track && /^spotify:track:[A-Za-z0-9]{22}$/.test(entry.uri)) known.set(entry.uri, Promise.resolve(track))
  }
  const tracks = new Array(items.length)
  let cursor = 0, done = 0, stopped = false
  progress(done, total)
  async function metadata(uri) {
    try {
      const track = embedded(await text(await request(`${OPEN}/embed/track/${uri.slice("spotify:track:".length)}`))).data.entity
      return trackInfo(track, uri)
    } catch (error) {
      if ([404, 410].includes(error.spotifyStatus)) return null
      throw error
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, items.length) }, async () => {
    while (!stopped && cursor < items.length) {
      const index = cursor++
      const uri = items[index]?.uri
      try {
        if (typeof uri !== "string") throw incomplete()
        if (/^spotify:track:[A-Za-z0-9]{22}$/.test(uri)) {
          if (!known.has(uri)) known.set(uri, metadata(uri))
          tracks[index] = await known.get(uri)
        }
        progress(++done, total)
      } catch (error) { stopped = true; throw error }
    }
  }))
  const available = tracks.filter(Boolean)
  if (!available.length) throw new MusicError("Esta lista no contiene canciones que se puedan importar.")
  return { name: typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : "Lista de Spotify", tracks: available, unavailable: total - available.length }
}
