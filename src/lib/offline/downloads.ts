"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { DataSource, MusicProvider, Track } from "../types"
import { brandStorage } from "../../stores/player.ts"
import { artworkSessionHeaders } from "../profile/session-token.ts"
import { canDownload, DEFAULT_LIMIT_MB, fits, formatBytes } from "./policy.ts"
import { isOffline } from "./connection.ts"
import { readAudio, readBlob } from "../audio/response.ts"
import { playbackBuffer } from "../audio/playback-buffer.ts"

export { readAudio } from "../audio/response.ts"

export { canDownload, DEFAULT_LIMIT_MB, formatBytes, LIMIT_OPTIONS_MB, usedBytes } from "./policy.ts"

/** Persistent WebView/browser disk storage, shared by APK, Tauri desktop and the web. */
export const OFFLINE_CACHE = "decibel-offline-v2"
const CONCURRENCY = 2
const META = "X-Decibel-Item"

export interface OfflineItem {
  track: Track
  source: DataSource
  scope: string
  size: number
  savedAt: number
}
interface OfflineState {
  items: Record<string, OfflineItem>
  limitMB: number
  pending: Record<string, "queued" | "downloading">
  artworkRevision: number
  setLimit: (mb: number) => void
}
export const useOffline = create<OfflineState>()(persist((set) => ({
  items: {}, limitMB: DEFAULT_LIMIT_MB, pending: {}, artworkRevision: 0,
  setLimit: (limitMB) => set({ limitMB: Math.max(1, limitMB) }),
}), { name: "decibel-offline", storage: brandStorage, version: 1, partialize: ({ items, limitMB }) => ({ items, limitMB }) }))

export const offlineKey = (source: DataSource, id: string, scope: string) => JSON.stringify([source, scope, id])
const cacheUrl = (key: string, kind = "audio") => `https://offline.decibel.local/${kind}/${encodeURIComponent(key)}`
const objectUrls = new Map<string, string>()
const coverUrls = new Map<string, string>()
const coverKey = (scope: string, art: string) => JSON.stringify([scope, art])

// Serialise disk commits and removals: concurrent completions cannot exceed the limit or resurrect a deletion.
let writes = Promise.resolve()
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = writes.then(work)
  writes = result.then(() => {}, () => {})
  return result
}
let running = 0
const queue: (() => Promise<void>)[] = []
const jobs = new Map<string, { controller: AbortController; promise: Promise<boolean> }>()
function pump() {
  while (running < CONCURRENCY && queue.length) {
    running++
    void queue.shift()!().finally(() => { running--; pump() })
  }
}
const setPending = (key: string, value?: "queued" | "downloading") => useOffline.setState((s) => {
  const pending = { ...s.pending }
  if (value) pending[key] = value
  else delete pending[key]
  return { pending }
})

async function fetchCover(provider: MusicProvider, track: Track, signal: AbortSignal) {
  const url = provider.coverUrl(track.coverArt, 300)
  if (!url) return null
  try {
    const response = await fetch(url, { credentials: "include", headers: artworkSessionHeaders(url), signal })
    // Covers are optional; limit them separately so oversized images cannot fill the device.
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) return null
    return await readBlob(response, 2 * 1024 * 1024, signal)
  } catch { return null }
}

function enqueue(track: Track, provider: MusicProvider): Promise<boolean> {
  const source = provider.kind, scope = provider.offlineScope
  if (!scope) return Promise.reject(new Error("No se pudo identificar la biblioteca de descargas."))
  const key = offlineKey(source, track.id, scope)
  const existing = jobs.get(key)
  if (existing) return existing.promise
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60_000)])
  let finish!: (ok: boolean) => void, fail!: (error: unknown) => void
  const promise = new Promise<boolean>((resolve, reject) => { finish = resolve; fail = reject })
  jobs.set(key, { controller, promise })
  setPending(key, "queued")
  queue.push(async () => {
    try {
      signal.throwIfAborted()
      if (await offlineUrl(source, track.id, scope)) { finish(false); return }
      if (isOffline()) throw new Error("Conéctate para descargar música.")
      setPending(key, "downloading")
      const request = provider.downloadRequest ? await provider.downloadRequest(track) : { url: await provider.streamUrl(track, signal) }
      const response = await fetch(request.url, { credentials: "include", headers: { ...request.headers, ...(source === "ytdlp" ? { "X-Decibel-Purpose": "download" } : {}) }, signal })
      const audio = await readAudio(response, useOffline.getState().limitMB * 1024 * 1024, signal)
      const cover = await fetchCover(provider, track, signal)
      await exclusive(async () => {
        signal.throwIfAborted()
        const size = audio.size + (cover?.size ?? 0)
        const { items, limitMB } = useOffline.getState()
        if (!fits(items, size, limitMB)) throw new Error(`Sin espacio: límite de ${formatBytes(limitMB * 1024 * 1024)} para descargas.`)
        const { starred, ...clean } = track
        void starred
        const item: OfflineItem = { track: clean, source, scope, size, savedAt: Date.now() }
        const cache = await caches.open(OFFLINE_CACHE)
        try {
          if (cover) await cache.put(cacheUrl(key, "cover"), new Response(cover))
          signal.throwIfAborted()
          // The disk record contains its metadata too, so it can recover after a localStorage write failure.
          await cache.put(cacheUrl(key), new Response(audio, { headers: { "Content-Type": audio.type, "Content-Length": String(audio.size), [META]: encodeURIComponent(JSON.stringify(item)) } }))
          signal.throwIfAborted()
        } catch (error) {
          await cache.delete(cacheUrl(key)); await cache.delete(cacheUrl(key, "cover")); throw error
        }
        if (cover && track.coverArt) {
          const artKey = coverKey(scope, track.coverArt)
          const old = coverUrls.get(artKey)
          if (old) URL.revokeObjectURL(old)
          coverUrls.set(artKey, URL.createObjectURL(cover))
        }
        useOffline.setState((s) => ({ items: { ...s.items, [key]: item }, artworkRevision: s.artworkRevision + 1 }))
      })
      finish(true)
    } catch (error) { fail(error) }
    finally { jobs.delete(key); setPending(key) }
  })
  pump()
  return promise
}

/** Queue music at two downloads at a time; duplicate requests share the same work. */
export async function download(tracks: Track[], provider: MusicProvider): Promise<{ ok: number; failed: string[] }> {
  if (typeof caches === "undefined") throw new Error("Este dispositivo no permite almacenamiento sin conexión.")
  if (isOffline()) throw new Error("Conéctate para descargar música.")
  void navigator.storage?.persist?.().catch(() => false)
  const unique = [...new Map(tracks.filter((t) => canDownload(provider.kind, t)).map((t) => [t.id, t])).values()]
  const results = await Promise.allSettled(unique.map((track) => enqueue(track, provider)))
  return {
    ok: results.filter((r) => r.status === "fulfilled" && r.value).length,
    failed: results.flatMap((r, i) => r.status === "rejected" ? [`${unique[i].title}: ${r.reason instanceof Error ? r.reason.message : "No se pudo descargar."}`] : []),
  }
}

export async function removeDownloads(keys: string[]) {
  for (const key of keys) jobs.get(key)?.controller.abort(new Error("Descarga cancelada."))
  await exclusive(async () => {
    const cache = typeof caches === "undefined" ? null : await caches.open(OFFLINE_CACHE)
    // An unsuccessful deletion remains visible and can be retried.
    for (const key of keys) {
      if (typeof caches !== "undefined" && useOffline.getState().items[key] && !useOffline.getState().items[key].scope) {
        await (await caches.open("decibel-offline-v1")).delete(`https://offline.decibel.local/${encodeURIComponent(key)}`)
      }
      await cache?.delete(cacheUrl(key))
      await cache?.delete(cacheUrl(key, "cover"))
      const url = objectUrls.get(key)
      if (url) { URL.revokeObjectURL(url); objectUrls.delete(key) }
    }
    useOffline.setState((s) => { const items = { ...s.items }; for (const key of keys) delete items[key]; return { items } })
    const kept = new Set(Object.values(useOffline.getState().items).flatMap((i) => i.track.coverArt ? [coverKey(i.scope, i.track.coverArt)] : []))
    for (const [key, url] of coverUrls) if (!kept.has(key)) { URL.revokeObjectURL(url); coverUrls.delete(key) }
  })
}

/** Blob URLs survive network loss and support native <audio> seeking, without cookies or remote URLs. */
export async function offlineUrl(source: DataSource, id: string, scope: string): Promise<string | null> {
  const key = offlineKey(source, id, scope)
  if (!useOffline.getState().items[key] || typeof caches === "undefined") return null
  const known = objectUrls.get(key)
  if (known) return known
  const hit = await (await caches.open(OFFLINE_CACHE)).match(cacheUrl(key))
  if (!hit) {
    useOffline.setState((s) => { const items = { ...s.items }; delete items[key]; return { items } })
    return null
  }
  const url = URL.createObjectURL(await hit.blob())
  objectUrls.set(key, url)
  return url
}

/** Disk is authoritative: restore metadata after restart and forget evicted audio. No network involved. */
export async function reconcileDownloads() {
  if (typeof caches === "undefined") return
  await exclusive(async () => {
    const cache = await caches.open(OFFLINE_CACHE)
    // Older Navidrome copies had no server/profile identity. Retain them for storage management,
    // without silently assigning private audio from a previous account to the current profile.
    const items = Object.fromEntries(Object.entries(useOffline.getState().items).filter(([, item]) => !item.scope))
    for (const request of await cache.keys()) {
      if (!new URL(request.url).pathname.startsWith("/audio/")) continue
      const hit = await cache.match(request)
      try {
        const item = JSON.parse(decodeURIComponent(hit?.headers.get(META) ?? "")) as OfflineItem
        if (!item.scope || !item.track?.id || !Number.isFinite(item.size) || item.size <= 0) continue
        const key = offlineKey(item.source, item.track.id, item.scope)
        if (request.url !== cacheUrl(key)) continue
        items[key] = item
        if (item.track.coverArt) {
          const artKey = coverKey(item.scope, item.track.coverArt)
          if (!coverUrls.has(artKey)) {
            const cover = await cache.match(cacheUrl(key, "cover"))
            if (cover) coverUrls.set(artKey, URL.createObjectURL(await cover.blob()))
          }
        }
      } catch { /* Ignore foreign or incomplete records. */ }
    }
    for (const [key, url] of objectUrls) if (!items[key]) { URL.revokeObjectURL(url); objectUrls.delete(key) }
    useOffline.setState((s) => ({ items, artworkRevision: s.artworkRevision + 1 }))
  })
}

/** Outermost provider: downloaded copies first, with all network-only playback work skipped offline. */
export function withOffline(inner: MusicProvider, scope: string): MusicProvider {
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "offlineScope") return scope
      if (prop === "streamUrl") return async (track: Track, signal?: AbortSignal, refresh?: boolean) => {
        signal?.throwIfAborted()
        const local = await offlineUrl(target.kind, track.id, scope)
        signal?.throwIfAborted()
        if (local) return local
        const buffered = playbackBuffer.url(scope, track.id)
        if (buffered) return buffered
        if (isOffline()) throw new Error("Esta canción no está descargada. Conéctate para escucharla.")
        return target.streamUrl(track, signal, refresh)
      }
      if (prop === "prepareTrack") return async (track: Track, signal?: AbortSignal) => {
        if (isOffline() || useOffline.getState().items[offlineKey(target.kind, track.id, scope)]) return
        await target.prepareTrack?.(track, signal)
      }
      if (prop === "getRecommendations" && target.getRecommendations) return (track: Track, signal?: AbortSignal) => isOffline() ? Promise.resolve([]) : target.getRecommendations!(track, signal)
      if (prop === "scrobble" && target.scrobble) return (id: string, submission: boolean) => isOffline() ? Promise.resolve() : target.scrobble!(id, submission)
      // Keep the same remote URL during an outage: mounted images and sampled colours are still valid.
      if (prop === "coverUrl") return (art: string | undefined, size?: number) => (art && coverUrls.get(coverKey(scope, art))) || target.coverUrl(art, size)
      const value = Reflect.get(target, prop, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}
