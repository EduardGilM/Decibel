import type { Track, TrackArtist } from "./types.ts"

/**
 * Credited artists of a song, each with the id of its page when there is one.
 * Catalogue songs carry `artists`; older entries (history, likes) only have the joined string and the
 * first artist's id, so the whole string links there, as before.
 */
export function trackArtists(track: Pick<Track, "artist" | "artistId" | "artists">): TrackArtist[] {
  const list = track.artists?.filter((a) => a?.name?.trim())
  if (list?.length) {
    return list.map((a, i) => ({ name: a.name, id: a.id || (i === 0 ? track.artistId : undefined) }))
  }
  return [{ name: track.artist, id: track.artistId }]
}
