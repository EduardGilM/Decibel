import type { Album, DataSource, Track } from "./types"

/** One real listen: recorded once per playback after ~30 s or half the song, whichever comes first. */
export interface HistoryEntry {
  id: string
  track: Track
  playedAt: number // epoch ms
  listened: number // seconds actually heard in that playback (kept up to date while it plays since 0.1.6)
  /** Music source it was played from: history is only replayable through the same provider. */
  source?: DataSource
}

/**
 * Storage seam for listening history. Today: local (zustand + localStorage).
 * Later: a server backend per profile implements the same contract (GET/POST /api/profiles/:id/history).
 */
export interface HistoryBackend {
  list(limit?: number): HistoryEntry[] | Promise<HistoryEntry[]>
  record(entry: HistoryEntry): void | Promise<void>
  clear(): void | Promise<void>
}

export const MIN_LISTEN_SECONDS = 30
export const MAX_HISTORY = 500

/** Seconds needed before a playback counts as a listen. Short songs count at 50 %. */
export function listenThreshold(duration: number) {
  return duration > 0 ? Math.min(MIN_LISTEN_SECONDS, duration * 0.5) : MIN_LISTEN_SECONDS
}

export const shouldRecord = (listened: number, duration: number) => listened >= listenThreshold(duration)

/** Accumulate only real playback: forward steps of the clock, ignoring seeks (big jumps) and rewinds. */
export function accumulate(listened: number, last: number, now: number, playing: boolean) {
  const step = now - last
  return playing && step > 0 && step < 2 ? listened + step : listened
}

const stored = (track: Track): Track => { const copy = { ...track }; delete copy.starred; return copy }

export function addEntry(entries: HistoryEntry[], track: Track, listened: number, playedAt = Date.now(), max = MAX_HISTORY, source?: DataSource): HistoryEntry[] {
  const entry: HistoryEntry = { id: `${playedAt}-${track.id}`, track: stored(track), playedAt, listened: Math.round(listened), source }
  return [entry, ...entries].slice(0, max)
}

/** The same playback kept playing: raise its heard time (never lowers it, other entries untouched). */
export function updateListened(entries: HistoryEntry[], id: string, listened: number): HistoryEntry[] {
  const seconds = Math.round(listened)
  const i = entries.findIndex((e) => e.id === id)
  if (i < 0 || seconds <= entries[i].listened) return entries
  const next = entries.slice()
  next[i] = { ...entries[i], listened: seconds }
  return next
}

/** Entries playable with the current source (old entries without a source are kept). */
export const fromSource = (entries: HistoryEntry[], source: DataSource | null) => (source ? entries.filter((e) => !e.source || e.source === source) : entries)

/** Albums from the most recent listens, newest first, one card per album. */
export function recentAlbums(entries: HistoryEntry[], limit = 12): Album[] {
  const seen = new Set<string>()
  const out: Album[] = []
  for (const { track } of entries) {
    const id = track.albumId
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, name: track.album, artist: track.artist, artistId: track.artistId, coverArt: track.coverArt, year: track.year, songCount: 0, duration: 0 })
    if (out.length >= limit) break
  }
  return out
}

/** Group entries by local day label for the history page. */
export function groupByDay(entries: HistoryEntry[], now = new Date()): { label: string; entries: HistoryEntry[] }[] {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = day(now), yesterday = today - 86_400_000
  const groups = new Map<string, HistoryEntry[]>()
  for (const entry of entries) {
    const d = new Date(entry.playedAt), key = day(d)
    const label = key === today ? "Hoy" : key === yesterday ? "Ayer" : d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })
    groups.set(label, [...(groups.get(label) ?? []), entry])
  }
  return [...groups].map(([label, list]) => ({ label, entries: list }))
}
