"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import { MAX_CROSSFADE } from "@/lib/audio/transition"
import { migrateSettings, SETTINGS_DEFAULTS } from "@/lib/settings-defaults"
import { brandStorage } from "./player"

export { migrateSettings, SETTINGS_DEFAULTS }

/** Playback preferences (local per device; synced per profile). */
interface SettingsState {
  crossfade: number // seconds, 0 = off
  gapless: boolean
  normalize: boolean
  defaults: number
  setCrossfade: (v: number) => void
  setGapless: (v: boolean) => void
  setNormalize: (v: boolean) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      crossfade: 0,
      gapless: true,
      normalize: true,
      defaults: SETTINGS_DEFAULTS,
      setCrossfade: (v) => set({ crossfade: Math.max(0, Math.min(MAX_CROSSFADE, Math.round(v))) }),
      setGapless: (gapless) => set({ gapless }),
      setNormalize: (normalize) => set({ normalize }),
    }),
    {
      name: "decibel-settings",
      storage: brandStorage,
      version: SETTINGS_DEFAULTS,
      migrate: (saved) => migrateSettings((saved ?? {}) as Partial<SettingsState>),
      partialize: ({ crossfade, gapless, normalize, defaults }) => ({ crossfade, gapless, normalize, defaults }),
    },
  ),
)
