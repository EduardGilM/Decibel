import { pipeline } from "node:stream/promises"
import { MusicError } from "./errors.mjs"

async function readJson(req) {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new MusicError("Se requiere JSON.", 415)
  let bytes = 0
  const chunks = []
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 8192) throw new MusicError("Petición demasiado grande.", 413); chunks.push(chunk) }
  let value
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { throw new MusicError("JSON no válido.") }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MusicError("Se requiere un objeto JSON.")
  return value
}

export async function handlePodcastApi(req, res, url, json, user, podcasts) {
  if (!url.pathname.startsWith("/api/podcasts/")) return false
  if (!user) throw new MusicError("Inicia sesión para continuar.", 401)
  const path = url.pathname.slice("/api/podcasts/".length)
  const method = req.method, query = url.searchParams
  const id = () => { const value = query.get("id"); if (!value || value.length > 100) throw new MusicError("Identificador de podcast o episodio no válido."); return value }
  if (method === "GET" && path === "top") { json(await podcasts.getTop(query.get("country") ?? undefined)); return true }
  if (method === "GET" && path === "search") { json(await podcasts.search(user.id, { q: query.get("q"), kind: query.get("kind") || "all", country: query.get("country") || "ES", limit: query.get("limit") ?? undefined })); return true }
  if (method === "POST" && path === "feeds") { const body = await readJson(req); json(await podcasts.importFeed(user.id, body.url), 201); return true }
  if (method === "GET" && path === "show") { json(await podcasts.getShow(user.id, id(), { q: query.get("q") || "", limit: query.get("limit") ?? undefined, offset: query.get("offset") ?? undefined })); return true }
  if (method === "GET" && path === "follows") { json(podcasts.getFollows(user.id)); return true }
  if (["PUT", "DELETE"].includes(method) && path === "follows") { json(podcasts.setFollowing(user.id, id(), method === "PUT")); return true }
  if (method === "GET" && path === "episode") { json({ episode: podcasts.getEpisode(user.id, id()) }); return true }
  if (method === "GET" && path === "progress") { json(podcasts.getProgress(user.id, id())); return true }
  if (method === "PUT" && path === "progress") { json(podcasts.saveProgress(user.id, id(), await readJson(req))); return true }
  if (method === "GET" && path === "listening") { json(podcasts.listProgress(user.id, { completed: query.get("completed") ?? undefined, limit: query.get("limit") ?? undefined, offset: query.get("offset") ?? undefined })); return true }
  if (method === "POST" && path === "stream") { const body = await readJson(req); json(await podcasts.getStream(user.id, body.id)); return true }
  if (method === "GET" && path === "artwork") {
    const image = await podcasts.getArtwork(id())
    res.writeHead(200, { "Content-Type": image.mimeType, "Content-Length": image.body.length, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" })
    res.end(image.body)
    return true
  }
  if (["GET", "HEAD"].includes(method) && path === "audio") {
    const controller = new AbortController()
    const abort = () => { if (!res.writableEnded) controller.abort() }
    res.once("close", abort)
    const timeout = setTimeout(() => controller.abort(new DOMException("Tiempo de conexión agotado", "TimeoutError")), 8000)
    let audio
    try {
      audio = await podcasts.openAudio(id(), { method, range: req.headers.range, ifRange: req.headers["if-range"], signal: controller.signal })
      clearTimeout(timeout)
      res.setHeader("X-Content-Type-Options", "nosniff")
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) if (audio.headers[name] !== undefined) res.setHeader(name, audio.headers[name])
      if (audio.status === 416) res.setHeader("Content-Length", "0")
      res.writeHead(audio.status)
      if (method === "HEAD" || audio.status === 416) { audio.body.destroy(); res.end() }
      else await pipeline(audio.body, res)
    } finally { clearTimeout(timeout); res.off("close", abort); audio?.body.destroy() }
    return true
  }
  if (["top", "search", "feeds", "show", "follows", "episode", "progress", "listening", "stream", "audio", "artwork"].includes(path)) throw new MusicError("Método no permitido.", 405)
  throw new MusicError("Ruta de podcasts no encontrada.", 404)
}
