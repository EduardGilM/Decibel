"use client"

import type { Album, Artist, DataSource, HomeData, MusicProvider, Playlist, Starred, Track } from "@/lib/types"
import { usePlayer } from "@/stores/player"
import { api } from "./api"

type Kind = "track" | "album" | "artist"

export interface PlaylistMember {
  id: string
  name: string
  role: "viewer" | "editor"
}

/** Server playlist: own, shared with this profile, or collaborative. */
export interface ProfilePlaylist extends Playlist {
  source: DataSource
  ownerId: string
  collaborative: boolean
  shared: boolean
  members: PlaylistMember[]
  role: "owner" | "editor" | "viewer"
  editable: boolean
  /** Owner name also for own lists (`owner` is left empty for those, like other sources). */
  ownerName?: string
  tracks?: (Track & { addedBy?: string; addedById?: string; addedAt?: number })[]
}

export const isProfilePlaylist = (id: string | null | undefined) => !!id?.startsWith("pl-")

/** A list created by the user on this device before profiles (imported, then hidden). */
export const isDeviceList = (source: DataSource, p: Playlist) => (source === "mock" ? p.owner === "local" : source === "ytdlp" ? !!p.editable : false)

const changed = () => window.dispatchEvent(new Event("decibel:data-changed"))
const key = (kind: Kind, id: string) => `${kind}:${id}`

/** Small offline fallback: last good answer per profile + key. */
function cached<T>(name: string, load: () => Promise<T>): Promise<T> {
  const storageKey = `decibel-profile-cache:${name}`
  return load().then(
    (value) => { try { localStorage.setItem(storageKey, JSON.stringify(value)) } catch {} return value },
    (error) => { const raw = localStorage.getItem(storageKey); if (raw) return JSON.parse(raw) as T; throw error },
  )
}

// Liked ids for the current profile and the item snapshots we have seen (star() only gets an id).
let likes: { source: DataSource; ids: Set<string>; load: Promise<Starred> } | null = null
const seen = new Map<string, Track | Album | Artist>()
if (typeof window !== "undefined") {
  window.addEventListener("decibel:profile-changed", () => { likes = null; seen.clear() })
  // Liked elsewhere: the hearts reload with the next answer.
  window.addEventListener("decibel:library-sync", () => { likes = null })
}

function loadLikes(source: DataSource, fresh = false) {
  if (!likes || likes.source !== source || fresh) {
    const load = cached(`likes:${source}`, () => api<Starred>(`/api/me/likes?source=${source}`))
    const entry = { source, ids: likes?.source === source ? likes.ids : new Set<string>(), load }
    likes = entry
    load.then((data) => {
      entry.ids = new Set([...data.tracks.map((t) => key("track", t.id)), ...data.albums.map((a) => key("album", a.id)), ...data.artists.map((a) => key("artist", a.id))])
    }).catch(() => {})
  }
  return likes.load
}

function kindOf(value: Record<string, unknown>): Kind | null {
  if ("title" in value && "duration" in value) return "track"
  if ("albumCount" in value) return "artist"
  if ("songCount" in value && "artist" in value) return "album"
  return null
}

/** Sets `starred` from the profile's likes on every track/album/artist inside a result. */
function mark<T>(value: T, depth = 0): T {
  if (!likes || depth > 4 || !value || typeof value !== "object") return value
  if (Array.isArray(value)) { value.forEach((v) => mark(v, depth + 1)); return value }
  const record = value as Record<string, unknown>
  const kind = typeof record.id === "string" ? kindOf(record) : null
  if (kind) {
    record.starred = likes.ids.has(key(kind, record.id as string))
    const { tracks, albums, topTracks, ...snapshot } = record
    void tracks; void albums; void topTracks
    seen.set(key(kind, record.id as string), snapshot as unknown as Track)
  }
  for (const child of Object.values(record)) if (child && typeof child === "object") mark(child, depth + 1)
  return value
}

const toPlaylist = (p: ProfilePlaylist): ProfilePlaylist => ({ ...p, ownerName: p.owner, owner: p.role === "owner" ? undefined : p.owner })

/**
 * Wraps the device's music source so likes and user playlists belong to the signed-in profile
 * (stored on the Decibel server). Catalogue, streaming and built-in lists come from the source.
 */
export function withProfile(inner: MusicProvider): MusicProvider {
  const source = inner.kind
  // Lists the user created on the device are replaced by profile lists; Navidrome lists (device account) and demo lists stay.
  const builtIn = (lists: Playlist[]) => lists.filter((p) => !isDeviceList(source, p))
  const profileLists = () => cached(`playlists:${source}`, () => api<ProfilePlaylist[]>(`/api/playlists?source=${source}`)).then((l) => l.map(toPlaylist))
  const withLikes = async <T,>(work: Promise<T>) => { await loadLikes(source).catch(() => null); return mark(await work) }
  const snapshot = async (id: string, type: Kind): Promise<Track | Album | Artist> => {
    const known = seen.get(key(type, id)) ?? (type === "track" ? usePlayer.getState().queue.find((t) => t.id === id) : undefined)
    if (known) return known
    if (type === "album") return inner.getAlbum(id)
    if (type === "artist") return inner.getArtist(id)
    throw new Error("No se ha podido guardar este tema.")
  }

  const overrides: Partial<MusicProvider> = {
    getHome: async () => {
      const [home, lists] = await Promise.all([withLikes(inner.getHome()), profileLists().catch(() => [] as Playlist[])])
      return { ...home, playlists: [...lists, ...builtIn(home.playlists)] } satisfies HomeData
    },
    getAlbum: (id) => withLikes(inner.getAlbum(id)),
    getArtist: (id) => withLikes(inner.getArtist(id)),
    getArtists: () => withLikes(inner.getArtists()),
    getAlbums: (type) => withLikes(inner.getAlbums(type)),
    search: (query, signal, filter) => withLikes(inner.search(query, signal, filter)),
    getRecommendations: inner.getRecommendations ? (track, signal) => withLikes(inner.getRecommendations!(track, signal)) : undefined,
    getPlaylists: async () => {
      const [lists, own] = await Promise.all([inner.getPlaylists().catch(() => [] as Playlist[]), profileLists()])
      return [...own, ...builtIn(lists)]
    },
    getPlaylist: (id) => (isProfilePlaylist(id) ? withLikes(cached(`playlist:${id}`, () => api<ProfilePlaylist>(`/api/playlists/${encodeURIComponent(id)}`)).then(toPlaylist)) : withLikes(inner.getPlaylist(id))),
    createPlaylist: async (name, track) => {
      const list = await api<ProfilePlaylist>("/api/playlists", { method: "POST", body: { source, name, track } })
      changed()
      return list
    },
    addToPlaylist: async (id, track) => {
      if (!isProfilePlaylist(id)) {
        if (!inner.addToPlaylist) throw new Error("Esta lista no admite canciones.")
        return inner.addToPlaylist(id, track)
      }
      const { added, playlist } = await api<{ added: boolean; playlist: ProfilePlaylist }>(`/api/playlists/${encodeURIComponent(id)}/tracks`, { method: "POST", body: { track } })
      if (!added) throw new Error("Ya está en la lista.")
      changed()
      return playlist
    },
    getStarred: async () => mark(await loadLikes(source, true)),
    star: async (id, type) => {
      const item = await snapshot(id, type)
      await api("/api/me/likes", { method: "PUT", body: { source, kind: type, item: { ...item, starred: undefined } } })
      likes?.ids.add(key(type, id))
      changed()
    },
    unstar: async (id, type) => {
      await api("/api/me/likes", { method: "DELETE", body: { source, kind: type, id } })
      likes?.ids.delete(key(type, id))
      changed()
    },
  }

  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop in overrides) return overrides[prop as keyof MusicProvider]
      const value = Reflect.get(target, prop, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

// ---- shared playlist actions used by the playlist page ----
const call = <T,>(path: string, method: string, body?: unknown) => api<T>(path, { method, body }).then((r) => { changed(); return r })
const at = (id: string) => `/api/playlists/${encodeURIComponent(id)}`
export const playlistActions = {
  rename: (id: string, name: string) => call<ProfilePlaylist>(at(id), "PATCH", { name }),
  setCollaborative: (id: string, collaborative: boolean) => call<ProfilePlaylist>(at(id), "PATCH", { collaborative }),
  remove: (id: string) => call(at(id), "DELETE"),
  removeTrack: (id: string, trackId: string) => call<ProfilePlaylist>(`${at(id)}/tracks/${encodeURIComponent(trackId)}`, "DELETE"),
  move: (id: string, from: number, to: number) => call<ProfilePlaylist>(`${at(id)}/move`, "POST", { from, to }),
  setMember: (id: string, userId: string, role: "viewer" | "editor" | null) => call<ProfilePlaylist>(`${at(id)}/members`, "PUT", { userId, role }),
  leave: (id: string) => call(`${at(id)}/members/me`, "DELETE"),
}
