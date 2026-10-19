import type { Track } from "@/lib/types"

export interface LyricsLine { time: number; text: string }
export interface LyricsLookup { title: string; artist: string; duration: number }
export interface LyricsRecord {
  id: number
  trackName: string
  artistName: string
  duration: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}
export interface LyricsResult {
  id: number
  instrumental: boolean
  text: string
  lines: LyricsLine[]
}

const annotations = /\s*[\[(](?=[^\])]*(?:oficial|official|lyrics|letra|audio|video|vídeo|visualizer|hd|4k))[^\])]*[\])]/gi
const clean = (value: string) => value.replace(annotations, "").replace(/\s+/g, " ").trim()
const cleanArtist = (value: string) => clean(value).replace(/\s*(?:-\s*Topic|VEVO|\(?Official\)?|\(?Oficial\)?)\s*$/i, "").trim()
const normalized = (value: string) => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(new RegExp("[^\\p{L}\\p{N}]", "gu"), "")

/** YouTube's display title and channel often contain the actual artist and title. */
export function lyricsLookup(track: Track): LyricsLookup {
  let title = clean(track.title)
  let artist = cleanArtist(track.artist)
  const split = track.id.startsWith("yt:") && track.metadataSource !== "ytmusic" ? title.match(/^(.+?)\s+[-–—]\s+(.+)$/) : null
  if (split) { artist = cleanArtist(split[1]); title = clean(split[2]) }
  return { title, artist, duration: Number.isFinite(track.duration) ? track.duration : 0 }
}

/** LRC line timestamps can repeat, so a chorus can have several times on one line. */
export function parseLrc(value: string): LyricsLine[] {
  const lines: LyricsLine[] = []
  for (const raw of value.split(/\r?\n/)) {
    const timestamps = [...raw.matchAll(/\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
    if (!timestamps.length) continue
    const text = raw.replace(/\[[^\]]*\]/g, "").trim()
    for (const timestamp of timestamps) {
      const time = Number(timestamp[1]) * 60 + Number(timestamp[2]) + Number(`0.${timestamp[3] || "0"}`)
      if (Number(timestamp[2]) < 60) lines.push({ time, text })
    }
  }
  return lines.sort((a, b) => a.time - b.time)
}

export function activeLyricsLine(lines: LyricsLine[], position: number) {
  let low = 0, high = lines.length - 1, active = -1
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (lines[mid].time <= position) { active = mid; low = mid + 1 } else high = mid - 1
  }
  return active
}

export function selectLyrics(records: LyricsRecord[], lookup: LyricsLookup): LyricsResult | null {
  const matches = records.filter((record) =>
    normalized(record.trackName) === normalized(lookup.title) && normalized(cleanArtist(record.artistName)) === normalized(lookup.artist),
  ).map((record) => {
    const difference = lookup.duration > 0 ? Math.abs(record.duration - lookup.duration) : Infinity
    const parsed = !record.instrumental && record.syncedLyrics ? parseLrc(record.syncedLyrics) : []
    const text = record.instrumental ? "" : record.plainLyrics?.trim() || parsed.map((line) => line.text).filter(Boolean).join("\n")
    // A different recording can share the words but have different timings.
    const lines = difference <= 2 && parsed.some((line) => line.text) ? parsed : []
    const result = { id: record.id, instrumental: record.instrumental, text, lines }
    return { result, difference, ready: difference <= 2 && (record.instrumental || lines.length > 0) }
  }).filter(({ result }) => result.instrumental || result.text)
  // A slightly closer plain record must not hide usable timings for the same recording.
  matches.sort((a, b) => Number(b.ready) - Number(a.ready) || a.difference - b.difference)
  return matches[0]?.result ?? null
}

interface LyricsCacheEntry { expires: number; result: LyricsResult | null }
type StoredLyrics = LyricsResult & { expires?: number }
const cache = new Map<string, LyricsCacheEntry>()

// Keep lyrics across restarts, with an expiry so plain text can later gain timings.
const STORE = "decibel-lyrics"
const STORE_MAX = 40
function stored(key: string): LyricsCacheEntry | undefined {
  try {
    const saved = (JSON.parse(globalThis.localStorage?.getItem(STORE) ?? "{}") as Record<string, StoredLyrics>)[key]
    if (!saved) return undefined
    // Legacy entries have no expiry: recheck them once, retaining the text as an offline fallback.
    const { expires = 0, ...result } = saved
    return { expires, result }
  } catch { return undefined }
}
function store(key: string, result: LyricsResult, expires: number) {
  try {
    const all = JSON.parse(globalThis.localStorage?.getItem(STORE) ?? "{}") as Record<string, StoredLyrics>
    delete all[key]
    all[key] = { ...result, expires }
    const keys = Object.keys(all)
    for (const old of keys.slice(0, Math.max(0, keys.length - STORE_MAX))) delete all[old]
    globalThis.localStorage?.setItem(STORE, JSON.stringify(all))
  } catch { /* storage full or unavailable */ }
}

/** Delays before each attempt: a failed lookup (network, timeout, 429/5xx) is retried at ~1 s, 3 s and 8 s. */
export const LYRICS_RETRY_DELAYS = [0, 1000, 3000, 8000]

/**
 * findLyrics with backoff. "Not found" (404 / no match) resolves to null at once and is not retried;
 * only errors are. Rejects with the last error when every attempt failed.
 */
export async function findLyricsWithRetry(track: Track, signal?: AbortSignal, delays = LYRICS_RETRY_DELAYS): Promise<LyricsResult | null> {
  let last: unknown
  for (const delay of delays) {
    if (delay) await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay)
      signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
    })
    if (signal?.aborted) throw signal.reason
    try { return await findLyrics(track, signal) } catch (error) {
      if (signal?.aborted) throw error
      last = error
    }
  }
  throw last
}

export async function findLyrics(track: Track, signal?: AbortSignal): Promise<LyricsResult | null> {
  const lookup = lyricsLookup(track)
  if (!lookup.title || !lookup.artist) return null
  const key = JSON.stringify(lookup)
  const cached = cache.get(key) ?? stored(key)
  if (cached && cached.expires > Date.now()) { cache.set(key, cached); return cached.result }
  const combined = AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])])
  async function request(route: string, params: URLSearchParams): Promise<LyricsRecord | LyricsRecord[] | null> {
    const response = await fetch(`https://lrclib.net/api/${route}?${params}`, { signal: combined })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(response.status === 429 ? "El servicio de letras está ocupado. Inténtalo en unos segundos." : "No se ha podido consultar el servicio de letras.")
    return response.json()
  }
  const params = new URLSearchParams({ track_name: lookup.title, artist_name: lookup.artist })
  if (lookup.duration > 0 && lookup.duration <= 3600) params.set("duration", String(Math.round(lookup.duration)))
  let result: LyricsResult | null = null
  let failed = false
  try {
    const exact = await request("get", params)
    const candidates = exact && !Array.isArray(exact) ? [exact] : []
    result = selectLyrics(candidates, lookup)
    if (!result?.instrumental && !result?.lines.length) {
      params.delete("duration")
      const records = await request("search", params)
      if (Array.isArray(records)) result = selectLyrics([...candidates, ...records], lookup)
    }
  } catch (error) {
    if (signal?.aborted || (!result && !cached?.result)) throw error
    failed = true // Keep available lyrics when the optional sync search or a refresh fails.
  }
  signal?.throwIfAborted()
  const saved = cached?.result
  if (!result || (!result.instrumental && !result.lines.length && saved?.lines.length)) result = saved ?? result
  const resolved = result && (result.instrumental || result.lines.length > 0)
  const expires = Date.now() + (failed ? 60_000 : resolved ? 6 * 60 * 60_000 : 10 * 60_000)
  cache.set(key, { result, expires })
  if (result) store(key, result, expires)
  if (cache.size > 100) cache.delete(cache.keys().next().value!)
  return result
}
