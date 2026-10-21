import { findSameTrack } from "./track-identity.ts"
import type { Playlist, Track } from "./types"

/**
 * Device-local playlists for sources without a playlist API (the demo catalogue).
 * Holds lists created on this device plus songs added to the built-in demo lists.
 * Pure state transitions; the storage adapter is injected so tests need no browser.
 */
export interface LocalPlaylistState {
  version: 1
  created: Playlist[]
  /** Songs appended to built-in lists, keyed by playlist id. */
  added: Record<string, Track[]>
}

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const LOCAL_PLAYLISTS_KEY = "decibel-playlists"
export const MAX_PLAYLIST_NAME = 80
export const emptyLocalPlaylists = (): LocalPlaylistState => ({ version: 1, created: [], added: {} })

export function loadLocalPlaylists(storage: KeyValueStorage | undefined, key = LOCAL_PLAYLISTS_KEY): LocalPlaylistState {
  try {
    const parsed = JSON.parse(storage?.getItem(key) ?? "null") as Partial<LocalPlaylistState> | null
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.created) || typeof parsed.added !== "object" || !parsed.added) return emptyLocalPlaylists()
    return { version: 1, created: parsed.created, added: parsed.added }
  } catch {
    return emptyLocalPlaylists()
  }
}

export function saveLocalPlaylists(storage: KeyValueStorage | undefined, state: LocalPlaylistState, key = LOCAL_PLAYLISTS_KEY) {
  storage?.setItem(key, JSON.stringify(state))
}

/** Strips per-user flags so a stored song does not freeze its "liked" state. */
const stored = (track: Track): Track => { const copy = { ...track }; delete copy.starred; return copy }

function summarise(playlist: Playlist, tracks: Track[]): Playlist {
  return { ...playlist, tracks, songCount: tracks.length, duration: tracks.reduce((sum, track) => sum + (track.duration || 0), 0) }
}

export function normalisePlaylistName(name: string) {
  const clean = name.trim().replace(/\s+/g, " ")
  if (!clean) throw new Error("Ponle un nombre a la lista.")
  return clean.slice(0, MAX_PLAYLIST_NAME)
}

export function createLocalPlaylist(state: LocalPlaylistState, name: string, track: Track | undefined, id: string, coverArt?: string): { state: LocalPlaylistState; playlist: Playlist } {
  const tracks = track ? [stored(track)] : []
  const playlist = summarise({ id, name: normalisePlaylistName(name), owner: "local", coverArt: coverArt ?? track?.coverArt, songCount: 0, duration: 0, editable: true }, tracks)
  return { state: { ...state, created: [playlist, ...state.created] }, playlist }
}

/** Adds a song once; adding a song that is already there is a no-op that reports `duplicate`. */
export function addToLocalPlaylist(state: LocalPlaylistState, base: Playlist | undefined, id: string, track: Track): { state: LocalPlaylistState; playlist: Playlist; duplicate: boolean } {
  const own = state.created.find((list) => list.id === id)
  if (own) {
    const current = own.tracks ?? []
    if (findSameTrack(current, track)) return { state, playlist: own, duplicate: true }
    const playlist = summarise({ ...own, coverArt: own.coverArt ?? track.coverArt }, [...current, stored(track)])
    return { state: { ...state, created: state.created.map((list) => (list.id === id ? playlist : list)) }, playlist, duplicate: false }
  }
  if (!base) throw new Error("Playlist no encontrada")
  const merged = withLocalAdditions(state, base)
  if (findSameTrack(merged.tracks, track)) return { state, playlist: merged, duplicate: true }
  const added = [...(state.added[id] ?? []), stored(track)]
  const next = { ...state, added: { ...state.added, [id]: added } }
  return { state: next, playlist: withLocalAdditions(next, base), duplicate: false }
}

/** A built-in list with this device's additions appended. */
export function withLocalAdditions(state: LocalPlaylistState, base: Playlist): Playlist {
  const extra = (state.added[base.id] ?? []).filter((song) => !base.tracks?.some((own) => own.id === song.id))
  return summarise({ ...base, editable: true }, [...(base.tracks ?? []), ...extra])
}

/** Device lists first (newest first), then the built-in ones. */
export function mergeLocalPlaylists(state: LocalPlaylistState, builtIn: Playlist[]): Playlist[] {
  return [...state.created, ...builtIn.map((list) => withLocalAdditions(state, list))]
}
