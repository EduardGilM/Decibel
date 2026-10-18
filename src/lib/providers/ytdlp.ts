import type { Album, Artist, ArtistRecommendations, Genre, HomeData, MusicProvider, Playlist, SearchFilter, SearchResult, Starred, Track } from "@/lib/types"
import { profileServerBase, sessionHeaders } from "../profile/session-token.ts"
import { sizedArtwork } from "../artwork-size.ts"

export interface StreamResult {
  url: string
  track: Track
}

export function normalizeMusicUrl(value: string) {
  const input = value.trim().replace(/\/+$/, "")
  if (!input) return ""
  const url = new URL(/^https?:\/\//i.test(input) ? input : `http://${input}`)
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Introduce la URL HTTP o HTTPS del servidor de Decibel.")
  }
  return url.toString().replace(/\/+$/, "")
}

export class YtDlpProvider implements MusicProvider {
  readonly kind = "ytdlp" as const
  private baseUrl: string

  constructor(serverUrl = "") {
    this.baseUrl = normalizeMusicUrl(serverUrl || profileServerBase())
    if (!this.baseUrl && process.env.NODE_ENV === "development" && typeof window !== "undefined") {
      const url = new URL(window.location.origin)
      url.port = "3001"
      this.baseUrl = url.origin
    }
  }

  private async request<T>(route: string, init: RequestInit = {}): Promise<T> {
    try {
      const signal = AbortSignal.any([AbortSignal.timeout(70_000), ...(init.signal ? [init.signal] : [])])
      const response = await fetch(`${this.baseUrl}/api/music/${route}`, {
        ...init, credentials: "include", headers: { "Content-Type": "application/json", ...sessionHeaders(this.baseUrl), ...init.headers }, signal, cache: "no-store",
      })
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("El servicio de música no está disponible. Arranca la app con npm run serve o configura su URL en Conectar a YouTube.")
      }
      const data = await response.json()
      if (!response.ok) throw Object.assign(new Error(data.error || `El servicio respondió ${response.status}.`), { status: response.status })
      return data as T
    } catch (error) {
      if (init.signal?.aborted) throw init.signal.reason
      if (error instanceof TypeError) throw new Error("No se puede conectar con el servicio de música. Revisa la URL y que el servidor esté encendido.")
      if (error instanceof DOMException && error.name === "TimeoutError") throw new Error("El servicio de música ha tardado demasiado. Vuelve a intentarlo.")
      throw error
    }
  }

  private changed() { window.dispatchEvent(new Event("decibel:data-changed")) }

  async ping() { await this.request("health") }
  getHome() { return this.request<HomeData>("home") }
  getAlbums(type = "alphabeticalByName") { return this.request<Album[]>(`albums?type=${encodeURIComponent(type)}`) }
  getAlbum(id: string) { return this.request<Album>(`album?id=${encodeURIComponent(id)}`) }
  getArtists() { return this.request<Artist[]>("artists") }
  getArtist(id: string) { return this.request<Artist>(`artist?id=${encodeURIComponent(id)}`) }
  getPlaylists() { return this.request<Playlist[]>("playlists") }
  getPlaylist(id: string) { return this.request<Playlist>(`playlist?id=${encodeURIComponent(id)}`) }
  async createPlaylist(name: string, track?: Track) {
    const playlist = await this.request<Playlist>("playlists", { method: "POST", body: JSON.stringify({ name, id: track?.id }) })
    this.changed()
    return playlist
  }
  async addToPlaylist(playlistId: string, track: Track) {
    const playlist = await this.request<Playlist>("playlist-tracks", { method: "POST", body: JSON.stringify({ playlistId, id: track.id }) })
    this.changed()
    return playlist
  }
  getStarred() { return this.request<Starred>("starred") }
  async getGenres(): Promise<Genre[]> { return [] }
  search(query: string, signal?: AbortSignal, filter: SearchFilter = "all") {
    return this.request<SearchResult>(`search?q=${encodeURIComponent(query)}&type=${filter}`, { signal })
  }
  getArtistRecommendations(id: string, signal?: AbortSignal) {
    return this.request<ArtistRecommendations>(`artist-recommendations?id=${encodeURIComponent(id)}`, { signal })
  }
  getRecommendations(track: Track, signal?: AbortSignal) {
    return this.request<Track[]>(`recommendations?id=${encodeURIComponent(track.id)}`, { signal })
  }
  /** `size`: slot size, so big headers / the full-screen player get a high-res copy instead of the row thumbnail. */
  coverUrl(coverArt: string | undefined, size?: number) {
    return coverArt ? `${this.baseUrl}/api/music/artwork?url=${encodeURIComponent(sizedArtwork(coverArt, size))}` : undefined
  }

  async star(id: string, type: "track" | "album" | "artist") {
    await this.request("starred", { method: "PUT", body: JSON.stringify({ id, type }) })
    this.changed()
  }
  async unstar(id: string, type: "track" | "album" | "artist") {
    await this.request("starred", { method: "DELETE", body: JSON.stringify({ id, type }) })
    this.changed()
  }
  async scrobble(id: string, submission: boolean) {
    await this.request("scrobble", { method: "POST", body: JSON.stringify({ id, submission }) })
  }

  async prepareTrack(track: Track, signal?: AbortSignal) {
    await this.request("prepare", { method: "POST", body: JSON.stringify({ id: track.id }), signal })
  }

  async streamUrl(track: Track, signal?: AbortSignal, refresh = false) {
    const stream = await this.request<StreamResult>("stream", { method: "POST", body: JSON.stringify({ id: track.id, refresh }), signal })
    if (!stream.url) throw new Error("No se pudo obtener la URL del audio.")
    this.changed()
    return stream.url
  }
}
