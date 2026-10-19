"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import { applyRecent, MAX_RECENT, migrateSearchState, recentItem, type RecentOp, type RecentRow } from "../lib/recent-searches.ts"
import type { DataSource, SearchFilter, Track } from "../lib/types"

/**
 * Shared state for the top-bar search input (survives page navigations) and the recent searches.
 * `rows` is the local copy per scope (shown at once); `queue` holds the changes not yet confirmed by the
 * server (sent by lib/profile/search-sync when a profile is signed in, also after being offline).
 */
interface SearchState {
  q: string
  /** set right before navigating so the next page's input regains focus */
  refocus: boolean
  setQ: (q: string) => void
  setRefocus: (v: boolean) => void
  /** Before 0.1.10: recent songs per scope, only on this device (migrated once to the profile). */
  recent: Record<string, Track[]>
  rows: Record<string, RecentRow[]>
  queue: Record<string, RecentOp[]>
  seq: number
  remember: (scope: string, track: Track) => void
  forget: (scope: string, id: string) => void
  clearRecent: (scope: string) => void
  /** The server's list after sending `sent` (those leave the queue); what is still queued stays applied. */
  confirm: (scope: string, rows: RecentRow[], sent: number[]) => void
}

const MAX_QUEUE = 200

export const useSearch = create<SearchState>()(persist((set) => {
  const push = (scope: string, make: (n: number, at: number) => RecentOp) => set((state) => {
    const op = make(state.seq + 1, Date.now())
    // First change on a device that only had the old local list: start from it.
    const base = state.rows[scope] ?? (state.recent[scope] ?? []).map((item, index): RecentRow => ({ kind: "track", item, at: op.at - index - 1 }))
    return {
      seq: state.seq + 1,
      rows: { ...state.rows, [scope]: applyRecent(base, [op]) },
      queue: { ...state.queue, [scope]: [...(state.queue[scope] ?? []), op].slice(-MAX_QUEUE) },
    }
  })
  return {
    q: "", refocus: false, recent: {}, rows: {}, queue: {}, seq: 0,
    setQ: (q) => set({ q }),
    setRefocus: (refocus) => set({ refocus }),
    remember: (scope, track) => push(scope, (n, at) => ({ n, op: "add", kind: "track", item: recentItem(track), at })),
    forget: (scope, id) => push(scope, (n, at) => ({ n, op: "remove", kind: "track", id, at })),
    clearRecent: (scope) => push(scope, (n, at) => ({ n, op: "clear", at })),
    confirm: (scope, rows, sent) => set((state) => {
      const current = state.queue[scope] ?? []
      const queue = current.filter((op) => !sent.includes(op.n))
      const next = { rows: { ...state.rows, [scope]: applyRecent(rows, queue, MAX_RECENT) } }
      // Keep the same `queue` object when nothing left it: search-sync syncs again whenever `queue` changes,
      // so a new object on every read would poll /api/me/searches in a loop (0.1.20).
      return queue.length === current.length ? next : { ...next, queue: { ...state.queue, [scope]: queue } }
    }),
  }
}, {
  name: "decibel-search",
  // 2 = 1 plus the migration that keeps 0.1.9's unversioned list (see migrateSearchState).
  version: 2,
  partialize: ({ recent, rows, queue, seq }) => ({ recent, rows, queue, seq }),
  migrate: (state, version) => migrateSearchState(state, version) as unknown as SearchState,
}))

export const searchScope = (source: DataSource | null, server = "", username = "") => JSON.stringify([source, source === "mock" ? "" : server.replace(/\/+$/, ""), source === "subsonic" ? username : ""])

export const searchHref = (q: string, type: SearchFilter | "artists" | "podcasts" = "all") => {
  const params = new URLSearchParams()
  if (q.trim()) params.set("q", q)
  if (type !== "all") params.set("type", type)
  return `/search/${params.size ? `?${params.toString()}` : ""}`
}
