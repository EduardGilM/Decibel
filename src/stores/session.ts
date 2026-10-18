"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { SubsonicCredentials } from "@/lib/providers/subsonic"
import type { DataSource } from "@/lib/types"
import { brandStorage, useLikes, usePlayer } from "./player"

export const DEFAULT_SOURCE: DataSource = process.env.NEXT_PUBLIC_DATA_SOURCE === "subsonic" ? "subsonic" : process.env.NEXT_PUBLIC_DATA_SOURCE === "mock" ? "mock" : "ytdlp"
export const DEFAULT_SERVER_URL = process.env.NEXT_PUBLIC_SUBSONIC_URL ?? ""
export const DEFAULT_MUSIC_URL = process.env.NEXT_PUBLIC_YTDLP_URL ?? ""
/** Builds with a fixed Decibel server (the APK): no source picker, Navidrome, demo or "other server". */
export const FIXED_SERVER = Boolean(process.env.NEXT_PUBLIC_DECIBEL_SERVER)

function resetPlayer() {
  usePlayer.getState().audio?.pause()
  usePlayer.setState({ queue: [], original: [], index: 0, isPlaying: false, buffering: false, position: 0, duration: 0, sourceLabel: undefined })
  useLikes.setState({ overrides: {} })
}

interface SessionState {
  mode: DataSource | null
  creds: SubsonicCredentials | null
  ytdlpUrl: string
  /** recently used servers, for quick login on shared devices */
  servers: string[]
  loginSubsonic: (creds: SubsonicCredentials) => void
  loginDemo: () => void
  loginYouTube: (serverUrl: string) => void
  logout: () => void
}

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      mode: DEFAULT_SOURCE === "subsonic" ? null : DEFAULT_SOURCE,
      creds: null,
      ytdlpUrl: DEFAULT_MUSIC_URL,
      servers: [],
      loginSubsonic: (creds) => {
        resetPlayer()
        set({ mode: "subsonic", creds, servers: [creds.serverUrl, ...get().servers.filter((s) => s !== creds.serverUrl)].slice(0, 5) })
      },
      loginDemo: () => { resetPlayer(); set({ mode: "mock", creds: null }) },
      loginYouTube: (ytdlpUrl) => { resetPlayer(); set({ mode: "ytdlp", creds: null, ytdlpUrl }) },
      logout: () => { resetPlayer(); set(FIXED_SERVER ? { mode: "ytdlp", creds: null, ytdlpUrl: DEFAULT_MUSIC_URL } : { mode: null, creds: null }) },
    }),
    {
      name: "decibel-session",
      storage: brandStorage,
      version: 1,
      // A fixed-server build always uses that server, whatever an older version saved (e.g. mode null after
      // "Cambiar fuente de música", which sent the app to the source picker on every launch).
      merge: (persisted, current) => {
        const state = { ...current, ...(persisted as Partial<SessionState>) }
        return FIXED_SERVER ? { ...state, mode: "ytdlp", creds: null, ytdlpUrl: DEFAULT_MUSIC_URL } : state
      },
      migrate: (persisted) => {
        const previous = persisted as Partial<SessionState>
        if (previous.mode === "mock" && DEFAULT_SOURCE === "ytdlp") {
          resetPlayer()
          return { ...previous, mode: "ytdlp", ytdlpUrl: DEFAULT_MUSIC_URL }
        }
        return { ...previous, ytdlpUrl: previous.ytdlpUrl ?? DEFAULT_MUSIC_URL }
      },
    },
  ),
)
