export type DataSource = "mock" | "subsonic" | "ytdlp"

export interface Track {
  id: string
  title: string
  artist: string
  artistId?: string
  /** Every credited artist in order (catalogue songs); `artist` stays the joined display string. */
  artists?: TrackArtist[]
  album: string
  albumId?: string
  coverArt?: string
  duration: number // seconds
  track?: number
  year?: number
  starred?: boolean
  /** ReplayGain tags (OpenSubsonic `replayGain`), in dB / linear peak. Used for volume normalisation. */
  replayGain?: { trackGain?: number; albumGain?: number; trackPeak?: number; albumPeak?: number }
  /** Canonical catalogue metadata does not need YouTube display-title splitting. */
  metadataSource?: "ytmusic"
  /** RSS episode routed through PodcastProvider instead of the YouTube extractor. */
  podcast?: { episodeId: string; podcastId: string }
}

export interface Album {
  id: string
  name: string
  artist: string
  artistId?: string
  coverArt?: string
  year?: number
  songCount: number
  duration: number
  genre?: string
  color?: string
  starred?: boolean
  tracks?: Track[]
}

export interface TrackArtist {
  id?: string
  name: string
}

/**
 * «Recomendadas para ti» on an artist page, from the catalogue: `tracks` are the artist's own songs (not in
 * Populares) by popularity, `deepCuts` less-known songs from their albums and singles, `artists` similar artists.
 */
export interface ArtistRecommendations {
  tracks: Track[]
  deepCuts?: Track[]
  artists: Artist[]
}

export interface Artist {
  id: string
  name: string
  coverArt?: string
  albumCount: number
  color?: string
  starred?: boolean
  albums?: Album[]
  topTracks?: Track[]
}

export interface Playlist {
  id: string
  name: string
  comment?: string
  owner?: string
  coverArt?: string
  songCount: number
  duration: number
  color?: string
  tracks?: Track[]
  /** User-owned collection that accepts songs; excludes automatic library lists. */
  editable?: boolean
}

export interface Genre {
  name: string
  songCount: number
  albumCount: number
}

export interface HomeData {
  recent: Album[]
  newest: Album[]
  frequent: Album[]
  random: Album[]
  playlists: Playlist[]
  artists: Artist[]
}

export interface SearchResult {
  artists: Artist[]
  albums: Album[]
  tracks: Track[]
}

export type SearchFilter = "all" | "tracks" | "albums" | "artists"

export interface Starred {
  tracks: Track[]
  albums: Album[]
  artists: Artist[]
}

/**
 * Every data source (mock, Subsonic/Navidrome, ...) implements this.
 * The UI only ever talks to a MusicProvider.
 */
export interface MusicProvider {
  readonly kind: DataSource
  ping(): Promise<void>
  getHome(): Promise<HomeData>
  getAlbum(id: string): Promise<Album>
  getArtist(id: string): Promise<Artist>
  getArtists(): Promise<Artist[]>
  getAlbums(type?: "newest" | "recent" | "frequent" | "random" | "alphabeticalByName"): Promise<Album[]>
  getPlaylists(): Promise<Playlist[]>
  getPlaylist(id: string): Promise<Playlist>
  createPlaylist?(name: string, track?: Track): Promise<Playlist>
  addToPlaylist?(id: string, track: Track): Promise<Playlist>
  getStarred(): Promise<Starred>
  getGenres(): Promise<Genre[]>
  search(query: string, signal?: AbortSignal, filter?: SearchFilter): Promise<SearchResult>
  star(id: string, type: "track" | "album" | "artist"): Promise<void>
  unstar(id: string, type: "track" | "album" | "artist"): Promise<void>
  coverUrl(coverArt: string | undefined, size?: number): string | undefined
  /** Optional known dominant colour (mock covers); otherwise computed from the image. */
  coverColor?(coverArt: string | undefined): string | undefined
  streamUrl(track: Track, signal?: AbortSignal, refresh?: boolean): Promise<string>
  prepareTrack?(track: Track, signal?: AbortSignal): Promise<void>
  getRecommendations?(track: Track, signal?: AbortSignal): Promise<Track[]>
  getArtistRecommendations?(id: string, signal?: AbortSignal): Promise<ArtistRecommendations>
  scrobble?(id: string, submission: boolean): Promise<void>
}
