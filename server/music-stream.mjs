import { pipeline } from "node:stream/promises"
import { createPodcastHttp } from "./podcast-http.mjs"
import { MusicError } from "./errors.mjs"
import { videoId } from "./ytdlp.mjs"

/** Only the server-resolved audio CDN is accepted; clients never supply a URL or upstream headers. */
export function musicAudioUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new MusicError("URL de audio no válida.", 502) }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.endsWith(".googlevideo.com")) {
    throw new MusicError("Origen de audio no permitido.", 502)
  }
  return url.href
}

// Reuse the public-address/DNS-pinning transport; validate every redirect as well.
const publicHttp = createPodcastHttp({ validateUrl: (value, base) => musicAudioUrl(new URL(value, base).href) })
export const musicHttp = async (value, options) => {
  const response = await publicHttp(musicAudioUrl(value), options)
  try { musicAudioUrl(response.url) } catch (error) { response.body.destroy(); throw error }
  return response
}

/** Auth is checked by createApp before this handler. Streams with backpressure, no server audio cache. */
export async function sendMusicStream(req, res, id, { music, request = musicHttp }) {
  const abort = new AbortController()
  const closed = () => { if (!res.writableFinished) abort.abort() }
  res.once("close", closed)
  try {
    id = videoId(id)
    const headers = {}
    if (req.headers.range) {
      if (!/^bytes=\d*-\d*$/.test(req.headers.range) || req.headers.range === "bytes=-") throw new MusicError("Rango no válido.", 416)
      headers.Range = req.headers.range
    }
    let upstream
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(10 * 60_000)])
    for (let attempt = 0; attempt < 2; attempt++) {
      const stream = await music.stream(id, { refresh: attempt > 0 })
      signal.throwIfAborted()
      upstream = await request(musicAudioUrl(stream.url), { method: req.method, headers, signal })
      if (attempt === 0 && [403, 410].includes(upstream.status)) { upstream.body.destroy(); continue }
      break
    }
    try {
      if (![200, 206, 416].includes(upstream.status)) throw new MusicError("No se pudo obtener el audio. Vuelve a intentarlo.", 502)
      if (upstream.status !== 416 && !/^(audio\/|video\/webm|video\/mp4|application\/octet-stream)/i.test(upstream.headers["content-type"] || "")) throw new MusicError("El servidor no devolvió audio.", 502)
      for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        if (upstream.headers[name]) res.setHeader(name, upstream.headers[name])
      }
      res.setHeader("X-Content-Type-Options", "nosniff")
      res.writeHead(upstream.status)
      if (req.method === "HEAD") res.end()
      else await pipeline(upstream.body, res)
    } finally { upstream.body.destroy() }
  } finally { res.off("close", closed) }
}
