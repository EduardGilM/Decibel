import { isIP } from "node:net"

const normalize = (ip = "") => ip.replace(/^::ffff:/, "")
const loopback = (ip) => ip === "::1" || /^127\./.test(ip)

/** Forwarded headers are trusted only from explicitly configured immediate peers. */
export function createRequestSecurity({ trustProxy = process.env.DECIBEL_TRUST_PROXY ?? false } = {}) {
  const value = String(trustProxy).trim().toLowerCase()
  const local = ["true", "1", "loopback"].includes(value)
  const disabled = ["false", "0", ""].includes(value)
  const peers = local || disabled ? [] : value.split(",").map((s) => normalize(s.trim()))
  if (peers.some((ip) => !isIP(ip))) throw new Error("DECIBEL_TRUST_PROXY requiere false, loopback o una lista de IP de proxies.")
  const trusted = (req) => {
    const ip = normalize(req.socket.remoteAddress)
    return local ? loopback(ip) : peers.includes(ip)
  }
  const isHttps = (req) => !!req.socket.encrypted || (trusted(req) && req.headers["x-forwarded-proto"] === "https")
  return {
    isHttps,
    clientIp(req) {
      const forwarded = req.headers["cf-connecting-ip"]
      return trusted(req) && typeof forwarded === "string" && isIP(forwarded) ? normalize(forwarded) : normalize(req.socket.remoteAddress) || "unknown"
    },
    sameOrigin(req, origin) {
      try { return new URL(origin).origin === new URL(`${isHttps(req) ? "https" : "http"}://${req.headers.host}`).origin } catch { return false }
    },
  }
}
