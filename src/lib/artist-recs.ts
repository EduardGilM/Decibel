import type { Artist, ArtistRecommendations, Track } from "./types.ts"
import { trackArtists } from "./track-artists.ts"

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s*[([].*?[)\]]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
const songKey = (t: Track) => `${norm(t.title)}|${norm(trackArtists(t)[0]?.name ?? t.artist)}`

export const MAX_RECOMMENDED_TRACKS = 10
const POPULAR_UNHEARD = 7
const DEEP_UNHEARD = 3

/**
 * «Recomendadas para ti» on an artist page: ONLY songs of this artist (also where they are featured), never
 * the ones already in Populares and never twice (same id or same title+artist).
 * Songs you have not listened to come first: up to 7 by popularity plus up to 3 less-known ones from the
 * discography; if that is not enough it fills up with songs you have already heard. «Artistas similares» is
 * a separate list.
 */
export function artistRecommendations(artist: Pick<Artist, "id" | "name" | "topTracks">, recs: ArtistRecommendations | undefined, history: Track[]): ArtistRecommendations {
  const shownIds = new Set<string>(), shownKeys = new Set<string>()
  for (const t of artist.topTracks ?? []) { shownIds.add(t.id); shownKeys.add(songKey(t)) }
  const name = norm(artist.name)
  const byArtist = (t: Track) => {
    const credits = trackArtists(t)
    if (credits.some((a) => a.id)) return credits.some((a) => a.id === artist.id) || t.artistId === artist.id
    return credits.some((a) => norm(a.name) === name)
  }
  const fresh = (list: Track[] | undefined) => (list ?? []).filter((t) => {
    if (t.podcast || !byArtist(t) || shownIds.has(t.id) || shownKeys.has(songKey(t))) return false
    shownIds.add(t.id); shownKeys.add(songKey(t)); return true
  })
  const popular = fresh(recs?.tracks), deep = fresh(recs?.deepCuts)
  const heardIds = new Set(history.map((t) => t.id)), heardKeys = new Set(history.map(songKey))
  const heard = (t: Track) => heardIds.has(t.id) || heardKeys.has(songKey(t))

  const picked: Track[] = []
  const add = (list: Track[], max = Infinity) => {
    let n = 0
    for (const t of list) { if (picked.length >= MAX_RECOMMENDED_TRACKS || n >= max) break; if (!picked.includes(t)) { picked.push(t); n++ } }
  }
  const unheardPopular = popular.filter((t) => !heard(t)), unheardDeep = deep.filter((t) => !heard(t))
  add(unheardPopular, POPULAR_UNHEARD)
  add(unheardDeep, DEEP_UNHEARD)
  add(unheardPopular); add(unheardDeep)
  add(popular.filter(heard)); add(deep.filter(heard))

  const related = (recs?.artists ?? []).filter((a, i, all) => a.id !== artist.id && all.findIndex((b) => b.id === a.id) === i)
  return { tracks: picked, artists: related.slice(0, 12) }
}
