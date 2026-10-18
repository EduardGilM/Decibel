import http from "node:http"
import https from "node:https"
import { lookup as resolveDns } from "node:dns/promises"
import { isIP } from "node:net"
import { createGunzip, createInflate, createBrotliDecompress } from "node:zlib"
import { MusicError } from "./errors.mjs"

export function podcastUrl(value, base) {
  if (typeof value !== "string") throw new MusicError("URL de podcast no válida.")
  let url
  try { url = new URL(value, base) } catch { throw new MusicError("URL de podcast no válida.") }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 4096) {
    throw new MusicError("Se requiere una URL pública HTTP o HTTPS sin credenciales ni puerto alternativo.")
  }
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if ((isIP(host) && !publicAddress(host)) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new MusicError("El podcast apunta a una dirección de red no permitida.")
  url.hash = ""
  return url.href
}

/** Public unicast only, including rejection of IPv4-mapped IPv6 and transition networks. */
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113))
  }
  if (isIP(address) !== 6) return false
  const [a, b] = address.split(":").map((part) => parseInt(part || "0", 16))
  return a >= 0x2000 && a <= 0x3fff && a !== 0x2002 && a !== 0x3fff
    && !(a === 0x2001 && (b <= 0x1ff || b === 0xdb8))
}

/** Resolve, validate and pin DNS on every connection and redirect; never forward user credentials. */
export function createPodcastHttp({ lookup = resolveDns, transports = { "http:": http.request, "https:": https.request } } = {}) {
  return async function request(value, { method = "GET", headers = {}, signal = AbortSignal.timeout(8000) } = {}) {
    let url = new URL(podcastUrl(value))
    for (let redirect = 0; redirect <= 5; redirect++) {
      signal.throwIfAborted()
      const hostname = url.hostname.replace(/^\[|\]$/g, "")
      const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason)
        signal.addEventListener("abort", abort, { once: true })
        lookup(hostname, { all: true, verbatim: true }).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
      })
      if (!addresses.length || addresses.some((entry) => !publicAddress(entry.address))) throw new MusicError("El podcast apunta a una dirección de red no permitida.", 400)
      const address = addresses.find((entry) => entry.family === 4) ?? addresses[0]
      const response = await new Promise((resolve, reject) => {
        const req = transports[url.protocol](url, {
          method, agent: false, signal,
          headers: { "User-Agent": "Decibel/1 (RSS podcast client)", "Accept-Encoding": "identity", ...headers },
          lookup: (_host, options, done) => options.all ? done(null, [address]) : done(null, address.address, address.family),
        }, resolve)
        req.on("error", reject)
        req.setTimeout(30_000, () => req.destroy(new Error("Podcast upstream idle timeout")))
        req.end()
      })
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.destroy()
        if (!response.headers.location || redirect === 5) throw new MusicError("Demasiadas redirecciones del podcast.", 502)
        url = new URL(podcastUrl(response.headers.location, url))
        continue
      }
      return { status: response.statusCode, headers: response.headers, body: response, url: url.href }
    }
  }
}

export async function readPodcastBody(response, maxBytes = 8 * 1024 * 1024) {
  const encoding = response.headers["content-encoding"]
  const decoder = encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : encoding === "br" ? createBrotliDecompress() : null
  if (encoding && encoding !== "identity" && !decoder) { response.body.destroy(); throw new MusicError("Codificación del podcast no compatible.", 502) }
  const stream = decoder ? response.body.pipe(decoder) : response.body
  if (decoder) response.body.on("error", (error) => decoder.destroy(error))
  const chunks = []
  let length = 0
  try {
    for await (const chunk of stream) {
      length += chunk.length
      if (length > maxBytes) throw new MusicError("La respuesta del podcast es demasiado grande.", 502)
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, length)
  } finally { stream.destroy(); response.body.destroy() }
}
