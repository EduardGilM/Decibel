"use client"

import { useMemo, useSyncExternalStore } from "react"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { addEntry, fromSource, recentAlbums, updateListened, type HistoryBackend, type HistoryEntry } from "@/lib/listen-history"
import type { Track } from "@/lib/types"
import { brandStorage } from "./player"
import { useSession } from "./session"

interface HistoryState {
  entries: HistoryEntry[]
  /** Returns the new entry's id so the tracker can keep its heard time up to date. */
  record: (track: Track, listened: number) => string
  update: (id: string, listened: number) => void
  clear: () => void
}

/** Local listening history. Swap `historyBackend` for a server one when profiles land. */
export const useHistory = create<HistoryState>()(
  persist(
    (set, get) => ({
      entries: [],
      record: (track, listened) => {
        set((s) => ({ entries: addEntry(s.entries, track, listened, Date.now(), undefined, useSession.getState().mode ?? undefined) }))
        return get().entries[0].id
      },
      update: (id, listened) => set((s) => {
        const entries = updateListened(s.entries, id, listened)
        return entries === s.entries ? s : { entries }
      }),
      clear: () => set({ entries: [] }),
    }),
    { name: "decibel-history", storage: brandStorage, version: 1 },
  ),
)

export const localHistoryBackend: HistoryBackend = {
  list: (limit) => useHistory.getState().entries.slice(0, limit),
  record: (entry) => { useHistory.getState().record(entry.track, entry.listened) },
  clear: () => useHistory.getState().clear(),
}

const subscribe = () => () => {}

/** Recent albums from real listens for the current source; [] during prerender/hydration. */
export function useRecentAlbums(limit = 12) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false)
  const entries = useHistory((s) => s.entries)
  const mode = useSession((s) => s.mode)
  return useMemo(() => (mounted ? recentAlbums(fromSource(entries, mode), limit) : []), [mounted, entries, mode, limit])
}
