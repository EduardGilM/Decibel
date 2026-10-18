import { api } from "../profile/api.ts"
import { profileServerBase } from "../profile/session-token.ts"
import type { ListeningPage, PodcastEpisode, PodcastFollows, PodcastPage, PodcastProgress, PodcastProgressUpdate, PodcastSearch, PodcastStream, PodcastTop } from "../podcasts.ts"
import type { MusicProvider, Track } from "../types"

function query(path: string, values: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, String(value))
  return `/api/podcasts/${path}?${params}`
}

/** Independent of the music source; profile API supplies cookie/Bearer auth and its 10 s deadline. */
export class PodcastProvider {
  getTop(country = "ES", signal?: AbortSignal) { return api<PodcastTop>(query("top", { country }), { signal }) }
  search(q: string, options: { kind?: "all" | "podcasts" | "episodes"; country?: string; limit?: number; signal?: AbortSignal } = {}) {
    const { signal, ...params } = options
    return api<PodcastSearch>(query("search", { q, ...params }), { signal })
  }
  importFeed(url: string, signal?: AbortSignal) { return api<PodcastPage>("/api/podcasts/feeds", { method: "POST", body: { url }, signal }) }
  getPodcast(id: string, options: { q?: string; limit?: number; offset?: number; signal?: AbortSignal } = {}) {
    const { signal, ...params } = options
    return api<PodcastPage>(query("show", { id, ...params }), { signal })
  }
  async getEpisode(id: string, signal?: AbortSignal) { return (await api<{ episode: PodcastEpisode }>(query("episode", { id }), { signal })).episode }
  getFollows(signal?: AbortSignal) { return api<PodcastFollows>("/api/podcasts/follows", { signal }) }
  async follow(id: string, signal?: AbortSignal) {
    const result = await api<{ following: true }>(query("follows", { id }), { method: "PUT", signal })
    if (typeof window !== "undefined") window.dispatchEvent(new Event("decibel:data-changed"))
    return result
  }
  async unfollow(id: string, signal?: AbortSignal) {
    const result = await api<{ following: false }>(query("follows", { id }), { method: "DELETE", signal })
    if (typeof window !== "undefined") window.dispatchEvent(new Event("decibel:data-changed"))
    return result
  }
  getProgress(id: string, signal?: AbortSignal) { return api<PodcastProgress>(query("progress", { id }), { signal }) }
  saveProgress(id: string, progress: PodcastProgressUpdate, signal?: AbortSignal) { return api<PodcastProgress>(query("progress", { id }), { method: "PUT", body: progress, signal }) }
  getListening(options: { completed?: boolean; limit?: number; offset?: number; signal?: AbortSignal } = {}) {
    const { signal, ...params } = options
    return api<ListeningPage>(query("listening", params), { signal })
  }
  getStream(id: string, signal?: AbortSignal) { return api<PodcastStream>("/api/podcasts/stream", { method: "POST", body: { id }, signal }) }
  async streamUrl(value: Track | PodcastEpisode, signal?: AbortSignal) { return (await this.getStream("podcast" in value && value.podcast ? value.podcast.episodeId : value.id, signal)).url }
  /** Cookie/Bearer-authenticated fetch clients may use this URL with Range; <audio> should use getStream().url. */
  proxyUrl(id: string) { return profileServerBase() + query("audio", { id }) }
  coverUrl(id: string) { return profileServerBase() + query("artwork", { id: id.replace(/^podcast-artwork:/, "") }) }
}

/** The same RSS episode queue works with YouTube, demo or Navidrome selected. */
export function withPodcasts(inner: MusicProvider): MusicProvider {
  const podcasts = new PodcastProvider()
  const overrides: Partial<MusicProvider> = {
    streamUrl: (track, signal, refresh) => track.podcast ? podcasts.streamUrl(track, signal) : inner.streamUrl(track, signal, refresh),
    prepareTrack: inner.prepareTrack ? (track, signal) => track.podcast ? Promise.resolve() : inner.prepareTrack!(track, signal) : undefined,
    getRecommendations: inner.getRecommendations ? (track, signal) => track.podcast ? Promise.resolve([]) : inner.getRecommendations!(track, signal) : undefined,
    getArtistRecommendations: inner.getArtistRecommendations ? (id, signal) => inner.getArtistRecommendations!(id, signal) : undefined,
    scrobble: inner.scrobble ? (id, submission) => id.startsWith("episode:") ? Promise.resolve() : inner.scrobble!(id, submission) : undefined,
    coverUrl: (coverArt, size) => coverArt?.startsWith("podcast-artwork:") ? podcasts.coverUrl(coverArt) : inner.coverUrl(coverArt, size),
  }
  return new Proxy(inner, { get(target, prop, receiver) {
    if (prop in overrides) return overrides[prop as keyof MusicProvider]
    const value = Reflect.get(target, prop, receiver)
    return typeof value === "function" ? value.bind(target) : value
  } })
}
