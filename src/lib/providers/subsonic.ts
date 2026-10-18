import SparkMD5 from "spark-md5"
import type { Album, Artist, Genre, HomeData, MusicProvider, Playlist, SearchResult, Starred, Track } from "@/lib/types"

export const SUBSONIC_API_VERSION = "1.16.1"
export const CLIENT_NAME = "decibel"

export interface SubsonicCredentials {
  serverUrl: string
  username: string
  token: string
  salt: string
}

/** Token auth: t = md5(password + salt). The plain password is never stored. */
export function makeCredentials(serverUrl: string, username: string, password: string): SubsonicCredentials {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  const salt = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
  return { serverUrl: normalizeUrl(serverUrl), username, salt, token: SparkMD5.hash(password + salt) }
}

export function normalizeUrl(url: string) {
  let u = url.trim().replace(/\/+$/, "")
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`
  return u
}

export class SubsonicError extends Error {
  constructor(message: string, public code?: number) {
    super(message)
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = Record<string, any>

const arr = <T,>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v])

function mapTrack(s: Raw): Track {
  return {
    id: s.id,
    title: s.title,
    artist: s.artist ?? "",
    artistId: s.artistId,
    album: s.album ?? "",
    albumId: s.albumId,
    coverArt: s.coverArt,
    duration: s.duration ?? 0,
    track: s.track,
    year: s.year,
    starred: !!s.starred,
    replayGain: s.replayGain && typeof s.replayGain === "object" ? (s.replayGain as Track["replayGain"]) : undefined,
  }
}

function mapAlbum(a: Raw): Album {
  return {
    id: a.id,
    name: a.name ?? a.title ?? a.album,
    artist: a.artist ?? "",
    artistId: a.artistId,
    coverArt: a.coverArt,
    year: a.year,
    songCount: a.songCount ?? 0,
    duration: a.duration ?? 0,
    genre: a.genre,
    starred: !!a.starred,
    tracks: a.song ? arr(a.song).map(mapTrack) : undefined,
  }
}

function mapArtist(a: Raw): Artist {
  return {
    id: a.id,
    name: a.name,
    coverArt: a.coverArt ?? (a.id ? `ar-${a.id}` : undefined),
    albumCount: a.albumCount ?? 0,
    starred: !!a.starred,
    albums: a.album ? arr(a.album).map(mapAlbum) : undefined,
  }
}

function mapPlaylist(p: Raw): Playlist {
  return {
    id: p.id,
    name: p.name,
    comment: p.comment,
    owner: p.owner,
    coverArt: p.coverArt,
    songCount: p.songCount ?? 0,
    duration: p.duration ?? 0,
    tracks: p.entry ? arr(p.entry).map(mapTrack) : undefined,
  }
}

const changed = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("decibel:data-changed")) }

export class SubsonicProvider implements MusicProvider {
  readonly kind = "subsonic" as const

  constructor(private creds: SubsonicCredentials) {}

  private params(extra: Record<string, string | number | undefined> = {}) {
    const p = new URLSearchParams({
      u: this.creds.username,
      t: this.creds.token,
      s: this.creds.salt,
      v: SUBSONIC_API_VERSION,
      c: CLIENT_NAME,
      f: "json",
    })
    for (const [k, v] of Object.entries(extra)) if (v !== undefined) p.set(k, String(v))
    return p
  }

  url(endpoint: string, extra: Record<string, string | number | undefined> = {}) {
    return `${this.creds.serverUrl}/rest/${endpoint}.view?${this.params(extra)}`
  }

  private async call(endpoint: string, extra: Record<string, string | number | undefined> = {}): Promise<Raw> {
    let res: Response
    try {
      res = await fetch(this.url(endpoint, extra))
    } catch {
      throw new SubsonicError("No se puede conectar con el servidor. Revisa la URL, la red o CORS.")
    }
    if (!res.ok) throw new SubsonicError(`El servidor respondió ${res.status}`)
    const json = (await res.json()) as Raw
    const body = json["subsonic-response"]
    if (!body) throw new SubsonicError("Respuesta no válida: ¿es un servidor Subsonic/Navidrome?")
    if (body.status !== "ok") throw new SubsonicError(body.error?.message ?? "Error desconocido", body.error?.code)
    return body
  }

  async ping() {
    await this.call("ping")
  }

  async getAlbums(type: "newest" | "recent" | "frequent" | "random" | "alphabeticalByName" = "alphabeticalByName", size = 30) {
    const r = await this.call("getAlbumList2", { type, size })
    return arr(r.albumList2?.album).map(mapAlbum)
  }

  async getHome(): Promise<HomeData> {
    const [recent, newest, frequent, random, playlists, artists] = await Promise.all([
      this.getAlbums("recent", 12),
      this.getAlbums("newest", 12),
      this.getAlbums("frequent", 12),
      this.getAlbums("random", 12),
      this.getPlaylists(),
      this.getArtists().then((a) => a.slice(0, 12)),
    ])
    return { recent, newest, frequent, random, playlists, artists }
  }

  async getAlbum(id: string) {
    const r = await this.call("getAlbum", { id })
    return mapAlbum(r.album)
  }

  async getArtist(id: string) {
    const r = await this.call("getArtist", { id })
    const artist = mapArtist(r.artist)
    try {
      const top = await this.call("getTopSongs", { artist: artist.name, count: 10 })
      artist.topTracks = arr(top.topSongs?.song).map(mapTrack)
    } catch {
      artist.topTracks = []
    }
    if (!artist.topTracks?.length && artist.albums?.[0]) {
      const first = await this.getAlbum(artist.albums[0].id)
      artist.topTracks = first.tracks?.slice(0, 5) ?? []
    }
    return artist
  }

  async getArtists() {
    const r = await this.call("getArtists")
    return arr(r.artists?.index).flatMap((i: Raw) => arr(i.artist).map(mapArtist))
  }

  /** Lists owned by the signed-in user accept songs; shared ones from other users stay read-only. */
  private own(p: Playlist): Playlist {
    return { ...p, editable: !p.owner || p.owner === this.creds.username }
  }

  async getPlaylists() {
    const r = await this.call("getPlaylists")
    return arr(r.playlists?.playlist).map(mapPlaylist).map((p) => this.own(p))
  }

  async getPlaylist(id: string) {
    const r = await this.call("getPlaylist", { id })
    return this.own(mapPlaylist(r.playlist))
  }

  async createPlaylist(name: string, track?: Track) {
    const r = await this.call("createPlaylist", { name: name.trim(), songId: track?.id })
    // API 1.14+ returns the new playlist; older servers return an empty ok.
    const created = r.playlist ? this.own(mapPlaylist(r.playlist)) : (await this.getPlaylists()).find((p) => p.name === name.trim())
    if (!created) throw new SubsonicError("El servidor no devolvió la lista creada.")
    changed()
    return created
  }

  async addToPlaylist(id: string, track: Track) {
    const current = await this.getPlaylist(id)
    if (!current.tracks?.some((song) => song.id === track.id)) {
      await this.call("updatePlaylist", { playlistId: id, songIdToAdd: track.id })
      changed()
      return this.getPlaylist(id)
    }
    return current
  }

  async getStarred(): Promise<Starred> {
    const r = await this.call("getStarred2")
    return {
      tracks: arr(r.starred2?.song).map(mapTrack),
      albums: arr(r.starred2?.album).map(mapAlbum),
      artists: arr(r.starred2?.artist).map(mapArtist),
    }
  }

  async getGenres(): Promise<Genre[]> {
    const r = await this.call("getGenres")
    return arr(r.genres?.genre).map((g: Raw) => ({ name: g.value, songCount: g.songCount ?? 0, albumCount: g.albumCount ?? 0 }))
  }

  async search(query: string): Promise<SearchResult> {
    if (!query.trim()) return { artists: [], albums: [], tracks: [] }
    const r = await this.call("search3", { query, artistCount: 10, albumCount: 20, songCount: 30 })
    return {
      artists: arr(r.searchResult3?.artist).map(mapArtist),
      albums: arr(r.searchResult3?.album).map(mapAlbum),
      tracks: arr(r.searchResult3?.song).map(mapTrack),
    }
  }

  private starParams(id: string, type: "track" | "album" | "artist") {
    return type === "album" ? { albumId: id } : type === "artist" ? { artistId: id } : { id }
  }

  async star(id: string, type: "track" | "album" | "artist") {
    await this.call("star", this.starParams(id, type))
  }

  async unstar(id: string, type: "track" | "album" | "artist") {
    await this.call("unstar", this.starParams(id, type))
  }

  coverUrl(coverArt: string | undefined, size = 300) {
    if (!coverArt) return undefined
    return this.url("getCoverArt", { id: coverArt, size })
  }

  async streamUrl(track: Track) {
    return this.url("stream", { id: track.id })
  }

  async scrobble(id: string, submission: boolean) {
    await this.call("scrobble", { id, submission: String(submission) })
  }
}
