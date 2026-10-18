"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { DataSource, SearchFilter, Track } from "@/lib/types"

/** Shared state for the top-bar search input (survives page navigations). */
interface SearchState {
  q: string
  /** set right before navigating so the next page's input regains focus */
  refocus: boolean
  setQ: (q: string) => void
  setRefocus: (v: boolean) => void
  recent: Record<string, Track[]>
  remember: (scope: string, track: Track) => void
  forget: (scope: string, id: string) => void
}

export const useSearch = create<SearchState>()(persist((set) => ({
  q: "", refocus: false, recent: {},
  setQ: (q) => set({ q }),
  setRefocus: (refocus) => set({ refocus }),
  remember: (scope, track) => set((state) => ({ recent: { ...state.recent, [scope]: [track, ...(state.recent[scope] || []).filter((item) => item.id !== track.id)].slice(0, 12) } })),
  forget: (scope, id) => set((state) => ({ recent: { ...state.recent, [scope]: (state.recent[scope] || []).filter((track) => track.id !== id) } })),
}), { name: "decibel-search", partialize: (state) => ({ recent: state.recent }) }))

export const searchScope = (source: DataSource | null, server = "", username = "") => JSON.stringify([source, source === "mock" ? "" : server.replace(/\/+$/, ""), source === "subsonic" ? username : ""])

export const searchHref = (q: string, type: SearchFilter | "artists" | "podcasts" = "all") => {
  const params = new URLSearchParams()
  if (q.trim()) params.set("q", q)
  if (type !== "all") params.set("type", type)
  return `/search/${params.size ? `?${params.toString()}` : ""}`
}
