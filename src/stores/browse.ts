"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import { rememberPlayback, type BrowseHistory, type ListeningSnapshot } from "../lib/browse-history.ts"
import { brandStorage } from "./player.ts"

interface BrowseState {
  profiles: Record<string, BrowseHistory>
  remember: (scope: string, state: ListeningSnapshot) => void
}

/** Music progress on this device, separated by profile, source and server. */
export const useBrowse = create<BrowseState>()(persist((set) => ({
  profiles: {},
  remember: (scope, state) => set((s) => {
    const history = rememberPlayback(s.profiles[scope], state)
    return history ? { profiles: { ...s.profiles, [scope]: history } } : s
  }),
}), { name: "decibel-browse", storage: brandStorage, version: 1 }))
