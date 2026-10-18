import type { Track } from "./types.ts"

/**
 * Recent searches shared by every device of a profile. The device shows its local copy at once, records
 * changes as operations with their time (kept while offline) and the server merges them (see
 * server/recent-searches.mjs): a repeated search moves to the top, deletes win over older searches.
 */
export const MAX_RECENT = 20
export type RecentKind = "track" | "album" | "artist" | "query"
export type RecentOp =
  | { n: number; op: "add"; kind: RecentKind; item: Track; at: number }
  | { n: number; op: "remove"; kind: RecentKind; id: string; at: number }
  | { n: number; op: "clear"; at: number }
export interface RecentRow { kind: RecentKind; item: Track; at: number }

/** What the dropdown needs to paint an entry exactly as before (cover, artists, album), nothing else. */
export function recentItem(track: Track): Track {
  const { id, title, artist, artistId, artists, album, albumId, coverArt, duration, year, metadataSource, podcast } = track
  return { id, title, artist, artistId, artists, album, albumId, coverArt, duration, year, metadataSource, podcast }
}

/** Applies operations on top of a list (newest first), as the server does. */
export function applyRecent(rows: RecentRow[], ops: RecentOp[], max = MAX_RECENT): RecentRow[] {
  let list = [...rows]
  for (const op of ops) {
    if (op.op === "add") list = [{ kind: op.kind, item: op.item, at: op.at }, ...list.filter((row) => !(row.kind === op.kind && row.item.id === op.item.id))]
    else if (op.op === "remove") list = list.filter((row) => !(row.kind === op.kind && row.item.id === op.id && row.at <= op.at))
    else list = list.filter((row) => row.at > op.at)
  }
  return list.sort((a, b) => b.at - a.at).slice(0, max)
}

/** Operations that upload a device's existing (pre-sync) list once, keeping its order. */
export function migrationOps(tracks: Track[], now: number, next: () => number): RecentOp[] {
  return tracks.slice(0, MAX_RECENT).map((track, index) => ({ n: next(), op: "add" as const, kind: "track" as const, item: recentItem(track), at: now - index - 1 })).reverse()
}

/** Server rows for the current list (validated: the server is trusted, but old clients may have sent junk). */
export function parseRows(value: unknown): RecentRow[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is RecentRow => !!row && typeof row === "object" && typeof row.kind === "string" && !!row.item && typeof row.item.id === "string" && Number.isFinite(row.at))
}

export const tracksOf = (rows: RecentRow[]) => rows.filter((row) => row.kind === "track").map((row) => row.item)
