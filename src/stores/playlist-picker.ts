"use client"

import { create } from "zustand"
import type { Track } from "@/lib/types"

interface PlaylistPickerState {
  track?: Track
  trigger?: HTMLElement
  show: (track: Track, trigger: HTMLElement) => void
  close: () => void
}

export const usePlaylistPicker = create<PlaylistPickerState>()((set) => ({
  show: (track, trigger) => set({ track, trigger }),
  close: () => set({ track: undefined }),
}))
