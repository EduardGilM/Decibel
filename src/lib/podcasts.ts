import type { Track } from "./types"

export interface PodcastProgress {
  episodeId: string
  position: number
  duration: number
  completed: boolean
  resumePosition: number
  revision: number
  updatedAt: number | null
}

export interface Podcast {
  id: string
  feedUrl: string
  title: string
  author: string
  description: string
  coverArt?: string
  language?: string
  appleUrl?: string
}

export interface PodcastEpisode {
  id: string
  podcastId: string
  podcastTitle: string
  title: string
  description: string
  author: string
  coverArt?: string
  enclosureUrl: string
  mimeType: string
  duration: number
  publishedAt: string | null
  explicit: boolean
  progress: PodcastProgress
}

export interface PodcastSearch {
  source: "itunes-rss"
  podcasts: Podcast[]
  episodes: PodcastEpisode[]
}
export interface PodcastTop {
  country: string
  source: "apple-charts"
  updatedAt: number
  sections: { id: string; title: string; podcasts: Podcast[] }[]
}
export interface FollowedPodcast extends Podcast {
  followedAt: number
}
export interface PodcastFollows {
  podcasts: FollowedPodcast[]
}
export interface PodcastPage {
  podcast: Podcast
  episodes: PodcastEpisode[]
  total: number
  limit: number
  offset: number
  stale: boolean
  following: boolean
}
export interface ListeningPage {
  episodes: PodcastEpisode[]
  total: number
  limit: number
  offset: number
}
export interface PodcastStream {
  url: string
  proxyPath: string
  mimeType: string
  episode: PodcastEpisode
  resumePosition: number
}
export type PodcastProgressUpdate = Partial<Pick<PodcastProgress, "position" | "duration" | "completed">> & { expectedRevision?: number }

/** Opaque artwork key understood by the existing music provider and authenticated image hook. */
export const podcastCover = (value: Podcast | PodcastEpisode) => value.coverArt ? `podcast-artwork:${value.id}` : undefined

/** Playback adapter; the UI can use the existing queue without introducing a new music source. */
export function podcastTrack(episode: PodcastEpisode): Track {
  return { id: episode.id, title: episode.title, artist: episode.author || episode.podcastTitle, album: episode.podcastTitle, albumId: episode.podcastId, coverArt: podcastCover(episode), duration: episode.duration, podcast: { episodeId: episode.id, podcastId: episode.podcastId } }
}
