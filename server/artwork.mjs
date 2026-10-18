import { setTimeout as delay } from "node:timers/promises"
import { MusicError } from "./errors.mjs"

const HOSTS = new Set(["yt3.googleusercontent.com", "lh3.googleusercontent.com", "yt3.ggpht.com", "lh3.ggpht.com", "i.ytimg.com", "i1.ytimg.com", "i2.ytimg.com", "i3.ytimg.com", "i4.ytimg.com"])
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_CACHE_BYTES = 32 * 1024 * 1024
export const ARTWORK_MAX_AGE = 6 * 60 * 60

function artworkUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new MusicError("URL de portada no válida.") }
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname) || url.port || url.username || url.password || url.hash) {
    throw new MusicError("Solo se admiten portadas de YouTube.")
  }
  return url.href
}

export function createArtworkService({ fetch: request = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map(), pending = new Map()
  let cacheBytes = 0

  const remove = (key) => { cacheBytes -= cache.get(key).body.length; cache.delete(key) }

  async function download(url) {
    let response
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // Never follow a CDN redirect to an arbitrary host or private address.
        response = await request(url, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { Accept: "image/avif,image/webp,image/*" } })
      } catch {
        if (attempt === 0) { await delay(300); continue }
        throw new MusicError("No se ha podido cargar la portada.", 502)
      }
      if (response.ok) break
      await response.body?.cancel()
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) { await delay(300); continue }
      throw new MusicError("La portada no está disponible.", 502)
    }
    const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()
    if (!IMAGE_TYPES.has(contentType) || Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) {
      await response.body?.cancel()
      throw new MusicError("Respuesta de portada no válida.", 502)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new MusicError("Portada vacía.", 502)
    const chunks = []
    let length = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > MAX_IMAGE_BYTES) { await reader.cancel(); throw new MusicError("Portada demasiado grande.", 502) }
        chunks.push(value)
      }
    } catch (error) {
      if (error instanceof MusicError) throw error
      throw new MusicError("No se ha podido cargar la portada.", 502)
    } finally { reader.releaseLock() }
    if (!length) throw new MusicError("Portada vacía.", 502)
    const image = { body: Buffer.concat(chunks, length), contentType, expires: now() + ARTWORK_MAX_AGE * 1000 }
    for (const [key, entry] of cache) if (entry.expires <= now()) remove(key)
    while (cache.size && (cache.size >= 200 || cacheBytes + length > MAX_CACHE_BYTES)) remove(cache.keys().next().value)
    cache.set(url, image)
    cacheBytes += length
    return image
  }

  return {
    async get(value) {
      const url = artworkUrl(value)
      const hit = cache.get(url)
      if (hit && hit.expires > now()) { cache.delete(url); cache.set(url, hit); return hit }
      if (hit) remove(url)
      if (pending.has(url)) return pending.get(url)
      const result = download(url).finally(() => pending.delete(url))
      pending.set(url, result)
      return result
    },
  }
}
