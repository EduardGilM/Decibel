import type { Track } from "./types"
import { duplicateCount as duplicates, findSameTrack as findSame, sameTrack as same } from "../../server/track-identity.mjs"

/** Minimal fields the identity needs (kept per playlist for the ✓ state). */
export type TrackRef = Pick<Track, "id" | "title" | "artist" | "duration"> & { artists?: { name?: string }[] }

export const trackRef = (track: TrackRef): TrackRef => ({ id: track.id, title: track.title, artist: track.artist, duration: track.duration, ...(track.artists ? { artists: track.artists.map((a) => ({ name: a.name })) } : {}) })
/** Same song: identical id, or same title (release noise aside) + main artist + duration within ±3 s. */
export const sameTrack = (a: TrackRef | undefined, b: TrackRef | undefined): boolean => same(a, b)
export const findSameTrack = <T extends TrackRef>(list: T[] | undefined, track: TrackRef): T | undefined => findSame(list, track)
export const duplicateCount = (list: TrackRef[] | undefined): number => duplicates(list)
