"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import { brandStorage } from "./player"

const MAX = 2000

/** Measured loudness per track id (LUFS, 0.1 precision). Measured once, cached on the device. */
export const useLoudness = create<{ lufs: Record<string, number>; set: (id: string, value: number) => void }>()(
  persist(
    (set) => ({
      lufs: {},
      set: (id, value) => set((s) => {
        const lufs = { ...s.lufs, [id]: Math.round(value * 10) / 10 }
        const keys = Object.keys(lufs)
        for (const key of keys.slice(0, Math.max(0, keys.length - MAX))) delete lufs[key]
        return { lufs }
      }),
    }),
    { name: "decibel-loudness", storage: brandStorage, partialize: ({ lufs }) => ({ lufs }) },
  ),
)
