"use client"

const KEY = "decibel-session-tokens"
let memory: Record<string, string> = {}

export function profileServerBase() {
  if (typeof window === "undefined") return ""
  let configured: string | null = null
  try { configured = window.localStorage?.getItem("decibel-server-url") } catch {}
  return (configured || process.env.NEXT_PUBLIC_DECIBEL_SERVER || "").replace(/\/+$/, "")
}

function serverKey(base: string) {
  try {
    const origin = typeof window === "undefined" ? undefined : window.location?.origin
    const url = new URL(base || origin!, origin)
    if (!["http:", "https:"].includes(url.protocol)) return null
    return url.origin + url.pathname.replace(/\/+$/, "")
  } catch { return null }
}

function tokens() {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage?.getItem(KEY)
    if (raw !== undefined) {
      const value = JSON.parse(raw || "{}")
      memory = value && typeof value === "object" && !Array.isArray(value) ? value : {}
    }
  } catch {}
  return memory
}

export function saveSessionToken(base: string, token?: string) {
  const key = serverKey(base)
  if (!key) return
  memory = { ...tokens() }
  if (token) memory[key] = token
  else delete memory[key]
  try { window.localStorage?.setItem(KEY, JSON.stringify(memory)) } catch {}
}

/** Keep same-origin web sessions HttpOnly; native and cross-origin clients need a Bearer token. */
export function needsSessionToken(base: string) {
  if (typeof window === "undefined") return false
  try {
    return "__TAURI_INTERNALS__" in window || new URL(base || window.location.origin, window.location.origin).origin !== window.location.origin
  } catch { return false }
}

/** Bound to the server and base path that issued it; never sent to a music/CDN third party. */
export function sessionHeaders(base: string): Record<string, string> {
  const key = serverKey(base)
  const token = key ? tokens()[key] : undefined
  return typeof token === "string" && token ? { Authorization: `Bearer ${token}` } : {}
}

export function artworkSessionHeaders(src?: string) {
  if (!src) return {}
  try {
    const url = new URL(src, window.location.origin)
    const route = ["/api/music/artwork", "/api/podcasts/artwork"].find((path) => url.pathname.endsWith(path))
    if (!route) return {}
    const marker = url.pathname.length - route.length
    return sessionHeaders(url.origin + url.pathname.slice(0, marker))
  } catch { return {} }
}
