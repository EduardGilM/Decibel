"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { DataSource, MusicProvider, Track } from "@/lib/types"
import { brandStorage } from "@/stores/player"
import { canDownload, DEFAULT_LIMIT_MB, fits, formatBytes } from "./policy"

export { canDownload, DEFAULT_LIMIT_MB, formatBytes, LIMIT_OPTIONS_MB, usedBytes } from "./policy"

/** Downloaded audio lives in Cache Storage; this store only keeps metadata (and the space limit). */
export const OFFLINE_CACHE = "decibel-offline-v1"
const CONCURRENCY = 2

export interface OfflineItem {
  track: Track
  source: DataSource
  size: number
  savedAt: number
}

interface OfflineState {
  items: Record<string, OfflineItem>
  limitMB: number
  /** Transient progress per item key. */
  pending: Record<string, "queued" | "downloading">
  setLimit: (mb: number) => void
}

export const useOffline = create<OfflineState>()(
  persist(
    (set) => ({
      items: {},
      limitMB: DEFAULT_LIMIT_MB,
      pending: {},
      setLimit: (limitMB) => set({ limitMB }),
    }),
    { name: "decibel-offline", storage: brandStorage, version: 1, partialize: ({ items, limitMB }) => ({ items, limitMB }) },
  ),
)

export const offlineKey = (source: DataSource, id: string) => `${source}:${id}`
const cacheUrl = (key: string) => `https://offline.decibel.local/${encodeURIComponent(key)}`


let running = 0
const queue: (() => Promise<void>)[] = []
function pump() {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift()!
    running++
    void job().finally(() => { running--; pump() })
  }
}

const setPending = (key: string, value?: "queued" | "downloading") =>
  useOffline.setState((s) => { const pending = { ...s.pending }; if (value) pending[key] = value; else delete pending[key]; return { pending } })

async function fetchAudio(url: string) {
  const sameOrigin = url.startsWith("/") || (typeof location !== "undefined" && url.startsWith(location.origin))
  // The header lets the server refuse offline copies of sources that do not allow them.
  const response = await fetch(url, { credentials: sameOrigin ? "include" : "omit", headers: sameOrigin ? { "X-Decibel-Purpose": "download" } : undefined })
  if (!response.ok) throw new Error(`No se pudo descargar (${response.status}).`)
  return response.blob()
}

/** Queue tracks for offline use (2 at a time). Resolves when all finished; returns failures. */
export function download(tracks: Track[], provider: MusicProvider): Promise<{ ok: number; failed: string[] }> {
  const source = provider.kind
  if (!canDownload(source)) return Promise.reject(new Error("Las canciones de YouTube no se pueden descargar."))
  if (typeof caches === "undefined") return Promise.reject(new Error("Este navegador no permite descargas sin conexión."))
  void navigator.storage?.persist?.().catch(() => false)
  let ok = 0
  const failed: string[] = []
  const jobs = tracks.filter((t) => canDownload(source, t)).map((track) => {
    const key = offlineKey(source, track.id)
    if (useOffline.getState().items[key] || useOffline.getState().pending[key]) return Promise.resolve()
    setPending(key, "queued")
    return new Promise<void>((resolve) => {
      queue.push(async () => {
        setPending(key, "downloading")
        try {
          const blob = await fetchAudio(await provider.streamUrl(track))
          const { items, limitMB } = useOffline.getState()
          if (!fits(items, blob.size, limitMB)) throw new Error(`Sin espacio: has llegado al límite de ${formatBytes(limitMB * 1024 * 1024)} para descargas.`)
          const cache = await caches.open(OFFLINE_CACHE)
          await cache.put(cacheUrl(key), new Response(blob, { headers: { "Content-Type": blob.type || "audio/mpeg", "Content-Length": String(blob.size) } }))
          const { starred, ...clean } = track
          void starred
          useOffline.setState((s) => ({ items: { ...s.items, [key]: { track: clean, source, size: blob.size, savedAt: Date.now() } } }))
          ok++
        } catch (error) {
          failed.push(`${track.title}: ${(error as Error).message}`)
        } finally {
          setPending(key)
          resolve()
        }
      })
      pump()
    })
  })
  return Promise.all(jobs).then(() => ({ ok, failed }))
}

const objectUrls = new Map<string, string>()

export async function removeDownloads(keys: string[]) {
  const cache = typeof caches === "undefined" ? null : await caches.open(OFFLINE_CACHE)
  await Promise.all(keys.map((key) => cache?.delete(cacheUrl(key))))
  for (const key of keys) { const url = objectUrls.get(key); if (url) { URL.revokeObjectURL(url); objectUrls.delete(key) } }
  useOffline.setState((s) => { const items = { ...s.items }; for (const key of keys) delete items[key]; return { items } })
}

/** Local blob URL for a downloaded track, or null. */
export async function offlineUrl(source: DataSource, id: string): Promise<string | null> {
  const key = offlineKey(source, id)
  if (!useOffline.getState().items[key] || typeof caches === "undefined") return null
  const known = objectUrls.get(key)
  if (known) return known
  const hit = await caches.match(cacheUrl(key))
  if (!hit) { useOffline.setState((s) => { const items = { ...s.items }; delete items[key]; return { items } }); return null }
  const url = URL.createObjectURL(await hit.blob())
  objectUrls.set(key, url)
  return url
}

/** Plays downloaded copies first (works without connection). */
export function withOffline(inner: MusicProvider): MusicProvider {
  if (!canDownload(inner.kind)) return inner
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "streamUrl") return async (track: Track, signal?: AbortSignal, refresh?: boolean) => (await offlineUrl(target.kind, track.id).catch(() => null)) ?? target.streamUrl(track, signal, refresh)
      const value = Reflect.get(target, prop, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}
