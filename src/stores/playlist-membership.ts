"use client"

import { create } from "zustand"
import { getProvider } from "@/lib/providers"
import type { Playlist } from "@/lib/types"

/**
 * Which of the user's own (editable) playlists contain each track, so ⊕ can turn into a green ✓.
 * The list summary is cheap; a playlist's tracks are only re-fetched when its rev / updatedAt / size changes.
 */
interface MembershipState {
  /** playlist id → track ids */
  lists: Record<string, string[]>
  add: (playlistId: string, trackId: string) => void
  refresh: () => Promise<void>
}

type Summary = Playlist & { rev?: number; updatedAt?: number }
const versions = new Map<string, string>()
const version = (p: Summary) => `${p.rev ?? ""}:${p.updatedAt ?? ""}:${p.songCount}:${p.tracks?.length ?? ""}`
let running: Promise<void> | null = null
let again = false
let started = false
let profileVersion = 0

export const usePlaylistMembership = create<MembershipState>()((set, get) => ({
  lists: {},
  add: (playlistId, trackId) => {
    const current = get().lists[playlistId] ?? []
    if (!current.includes(trackId)) set({ lists: { ...get().lists, [playlistId]: [...current, trackId] } })
  },
  refresh: async () => {
    if (running) { again = true; return running }
    const profile = profileVersion
    running = (async () => {
      try {
        const provider = getProvider()
        const own = ((await provider.getPlaylists()) as Summary[]).filter((p) => p.editable === true)
        if (profile !== profileVersion) return
        const next: Record<string, string[]> = {}
        const nextVersions = new Map<string, string>()
        await Promise.all(own.map(async (p) => {
          nextVersions.set(p.id, version(p))
          const known = get().lists[p.id]
          if (known && versions.get(p.id) === version(p)) { next[p.id] = known; return }
          const tracks = p.tracks ?? (await provider.getPlaylist(p.id)).tracks ?? []
          next[p.id] = tracks.map((t) => t.id)
        }))
        if (profile !== profileVersion) return
        // Publish versions with their tracks only after the complete batch succeeds.
        versions.clear()
        nextVersions.forEach((value, id) => versions.set(id, value))
        set({ lists: next })
      } catch { /* offline / signed out: keep what we had */ }
    })().finally(() => { running = null; if (again) { again = false; void get().refresh() } })
    return running
  },
}))

/** Starts loading on first use and follows library / profile changes (debounced). */
function start() {
  if (started || typeof window === "undefined") return
  started = true
  let timer: ReturnType<typeof setTimeout> | undefined
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => void usePlaylistMembership.getState().refresh(), 600) }
  window.addEventListener("decibel:data-changed", soon)
  window.addEventListener("decibel:profile-changed", () => { profileVersion++; versions.clear(); usePlaylistMembership.setState({ lists: {} }); soon() })
  void usePlaylistMembership.getState().refresh()
}

export function useInPlaylist(trackId: string | undefined) {
  start()
  return usePlaylistMembership((s) => !!trackId && Object.values(s.lists).some((ids) => ids.includes(trackId)))
}
