import type { HistoryEntry } from "./listen-history"
import type { Track } from "./types"

/**
 * "Tu Wrapped": yearly/monthly listening summary computed from the profile's real history
 * (one entry per playback that passed the 30 s / half-song mark). Pure functions, no I/O.
 * Nothing is estimated: a card whose data is missing or too thin is simply left out (`null`).
 */

export type WrappedRange = "month" | "year" | "all"

export const RANGES: { value: WrappedRange; label: string; title: string }[] = [
  { value: "month", label: "Este mes", title: "este mes" },
  { value: "year", label: "Este año", title: "este año" },
  { value: "all", label: "Desde siempre", title: "desde siempre" },
]

/** Fewer real listens than this (or fewer distinct songs) → friendly "aún te conocemos poco" state. */
export const MIN_LISTENS = 8
export const MIN_TRACKS = 3
/**
 * Until 0.1.6 `listened` stopped growing once the listen was recorded (~30 s). From this moment the
 * app keeps updating it while the song plays, so minutes before it are a floor, not the full time.
 */
export const FULL_LISTEN_SINCE = Date.UTC(2026, 9, 18, 12)

export interface RankedTrack { track: Track; plays: number; seconds: number }
export interface RankedArtist { id: string; artistId?: string; name: string; coverArt?: string; plays: number; seconds: number }
export interface RankedAlbum { id: string; name: string; artist: string; coverArt?: string; plays: number; seconds: number }

export interface WrappedStats {
  range: WrappedRange
  from: number
  to: number
  listens: number
  distinctTracks: number
  seconds: number
  /** Part of the period predates full listen tracking: `seconds` is a lower bound. */
  partialMinutes: boolean
  activeDays: number
  topTracks: RankedTrack[]
  topArtists: RankedArtist[]
  topAlbums: RankedAlbum[]
  /** Song played most often (only when it was played at least twice) and its best single day. */
  mostRepeated: { track: Track; plays: number; bestDay: number; bestDayPlays: number } | null
  /** Hour of day (0–23, local) and weekday (0 = lunes) with most listens; null when there is no clear pattern. */
  peakHour: { hour: number; plays: number; share: number } | null
  peakWeekday: { day: number; plays: number; share: number } | null
  /** Longest run of consecutive local days with at least one listen, and the run ending today/yesterday. */
  streak: { longest: number; longestFrom: number; longestTo: number; current: number } | null
  /** Only when the tracks really carry genre tags (OpenSubsonic); YouTube Music history has none. */
  genre: { name: string; share: number } | null
  enough: boolean
}

export function rangeStart(range: WrappedRange, now = new Date()) {
  if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  if (range === "year") return new Date(now.getFullYear(), 0, 1).getTime()
  return 0
}

export const isMusic = (entry: HistoryEntry) => Boolean(entry.track) && !entry.track.podcast && !entry.track.id.startsWith("podcast")

const dayKey = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() }
/** Next local day (DST-safe: not +24 h). */
const nextDay = (key: number) => { const d = new Date(key); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() }
const norm = (s: string) => s.trim().toLocaleLowerCase("es")
const artistKey = (t: Track) => `name:${norm(t.artist)}`

function rank<T extends { plays: number; seconds: number; last: number }>(map: Map<string, T>, limit = 5) {
  return [...map.values()].sort((a, b) => b.plays - a.plays || b.seconds - a.seconds || b.last - a.last).slice(0, limit)
}

function peak(counts: number[], total: number) {
  let best = -1, second = -1
  for (let i = 0; i < counts.length; i++) {
    if (best < 0 || counts[i] > counts[best]) { second = best; best = i } else if (second < 0 || counts[i] > counts[second]) second = i
  }
  // Needs a few listens in that slot and a real winner (no tie with the runner-up).
  if (best < 0 || counts[best] < 3 || (second >= 0 && counts[second] === counts[best])) return null
  return { index: best, plays: counts[best], share: counts[best] / total }
}

export function computeWrapped(all: HistoryEntry[], range: WrappedRange, now = new Date()): WrappedStats {
  const from = rangeStart(range, now), to = now.getTime()
  const entries = all.filter((e) => isMusic(e) && e.playedAt >= from && e.playedAt <= to + 60_000)
  type T = RankedTrack & { last: number }
  type A = RankedArtist & { last: number; best: number }
  type L = RankedAlbum & { last: number }
  const tracks = new Map<string, T>(), artists = new Map<string, A>(), albums = new Map<string, L>()
  const hours = Array<number>(24).fill(0), weekdays = Array<number>(7).fill(0)
  const days = new Set<number>()
  const perDay = new Map<string, number>()
  const genres = new Map<string, number>()
  let seconds = 0, tagged = 0, partialMinutes = false

  for (const e of entries) {
    const t = e.track, heard = Math.max(0, e.listened || 0), at = e.playedAt
    seconds += heard
    if (at < FULL_LISTEN_SINCE) partialMinutes = true
    const tr = tracks.get(t.id) ?? { track: t, plays: 0, seconds: 0, last: 0 }
    tr.plays++; tr.seconds += heard
    if (at > tr.last) { tr.last = at; tr.track = t }
    tracks.set(t.id, tr)

    if (t.artist) {
      // By name: the same artist reaches the history with different ids (YouTube Music channel vs. video search).
      const key = artistKey(t)
      const ar = artists.get(key) ?? { id: key, artistId: t.artistId, name: t.artist, plays: 0, seconds: 0, last: 0, best: 0 }
      ar.plays++; ar.seconds += heard; ar.last = Math.max(ar.last, at)
      if (!ar.artistId && t.artistId) ar.artistId = t.artistId
      if (t.artistId?.startsWith("ytm-artist:")) ar.artistId = t.artistId // canonical catalogue id has the real photo
      artists.set(key, ar)
    }
    if (t.albumId && t.album) {
      const al = albums.get(t.albumId) ?? { id: t.albumId, name: t.album, artist: t.artist, coverArt: t.coverArt, plays: 0, seconds: 0, last: 0 }
      al.plays++; al.seconds += heard
      if (at > al.last) { al.last = at; if (t.coverArt) al.coverArt = t.coverArt }
      albums.set(t.albumId, al)
    }
    const d = new Date(at)
    hours[d.getHours()]++
    weekdays[(d.getDay() + 6) % 7]++
    const key = dayKey(at)
    days.add(key)
    perDay.set(`${t.id}|${key}`, (perDay.get(`${t.id}|${key}`) ?? 0) + 1)
    const genre = (t as Track & { genre?: string }).genre?.trim()
    if (genre) { tagged++; genres.set(genre, (genres.get(genre) ?? 0) + 1) }
  }

  // Artist picture: the cover of that artist's most played song (the page may swap in the real artist photo).
  const artistCover = new Map<string, { plays: number; coverArt?: string }>()
  for (const tr of tracks.values()) {
    const key = artistKey(tr.track)
    const prev = artistCover.get(key)
    if (tr.track.coverArt && (!prev || tr.plays > prev.plays)) artistCover.set(key, { plays: tr.plays, coverArt: tr.track.coverArt })
  }
  for (const ar of artists.values()) ar.coverArt = artistCover.get(ar.id)?.coverArt

  const topTracks = rank(tracks).map(({ track, plays, seconds }) => ({ track, plays, seconds }))
  const topArtists = rank(artists).map(({ id, artistId, name, coverArt, plays, seconds }) => ({ id, artistId, name, coverArt, plays, seconds }))
  const topAlbums = rank(albums).map(({ id, name, artist, coverArt, plays, seconds }) => ({ id, name, artist, coverArt, plays, seconds }))

  let mostRepeated: WrappedStats["mostRepeated"] = null
  const top = topTracks[0]
  if (top && top.plays >= 2) {
    let bestDay = 0, bestDayPlays = 0
    for (const [k, n] of perDay) {
      const [id, day] = k.split("|")
      if (id === top.track.id && (n > bestDayPlays || (n === bestDayPlays && Number(day) > bestDay))) { bestDay = Number(day); bestDayPlays = n }
    }
    mostRepeated = { track: top.track, plays: top.plays, bestDay, bestDayPlays }
  }

  const h = peak(hours, entries.length), w = peak(weekdays, entries.length)

  let streak: WrappedStats["streak"] = null
  if (days.size) {
    const sorted = [...days].sort((a, b) => a - b)
    let longest = 1, longestFrom = sorted[0], longestTo = sorted[0], run = 1, runFrom = sorted[0]
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === nextDay(sorted[i - 1])) run++
      else { run = 1; runFrom = sorted[i] }
      if (run > longest) { longest = run; longestFrom = runFrom; longestTo = sorted[i] }
    }
    const today = dayKey(to)
    let current = 0
    let cursor = days.has(today) ? today : (() => { const d = new Date(today); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime() })()
    while (days.has(cursor)) { current++; const d = new Date(cursor); cursor = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime() }
    if (longest >= 2) streak = { longest, longestFrom, longestTo, current }
  }

  let genre: WrappedStats["genre"] = null
  if (entries.length && tagged / entries.length > 0.5) {
    const [name, n] = [...genres].sort((a, b) => b[1] - a[1])[0]
    genre = { name, share: n / tagged }
  }

  return {
    range, from, to,
    listens: entries.length,
    distinctTracks: tracks.size,
    seconds,
    partialMinutes,
    activeDays: days.size,
    topTracks, topArtists, topAlbums,
    mostRepeated,
    peakHour: h && { hour: h.index, plays: h.plays, share: h.share },
    peakWeekday: w && { day: w.index, plays: w.plays, share: w.share },
    streak,
    genre,
    enough: entries.length >= MIN_LISTENS && tracks.size >= MIN_TRACKS,
  }
}

export const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
export const WEEKDAYS_PLURAL = ["los lunes", "los martes", "los miércoles", "los jueves", "los viernes", "los sábados", "los domingos"]

export const minutesOf = (seconds: number) => Math.round(seconds / 60)
export const hourRange = (hour: number) => `${String(hour).padStart(2, "0")}:00–${String((hour + 1) % 24).padStart(2, "0")}:00`

/** Part of the day for the "momento" card. */
export function dayPart(hour: number) {
  if (hour < 6) return "de madrugada"
  if (hour < 13) return "por la mañana"
  if (hour < 21) return "por la tarde"
  return "por la noche"
}

export const plays = (n: number) => `${n} ${n === 1 ? "vez" : "veces"}`
export const formatMinutes = (n: number) => n.toLocaleString("es-ES")
