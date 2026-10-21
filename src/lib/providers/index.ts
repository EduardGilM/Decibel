"use client"

import { useMemo } from "react"
import type { DataSource, MusicProvider } from "@/lib/types"
import { withOffline } from "@/lib/offline/downloads"
import { sourceScope } from "@/lib/offline/context"
import { withProfile } from "@/lib/profile/provider"
import { useProfile } from "@/stores/profile"
import { useSession } from "@/stores/session"
import { MockProvider } from "./mock"
import { SubsonicProvider } from "./subsonic"
import { YtDlpProvider } from "./ytdlp"
import { withPodcasts } from "./podcasts"

let mock: MockProvider | null = null

export function createProvider(mode: DataSource | null, creds: ReturnType<typeof useSession.getState>["creds"], ytdlpUrl = "", profile?: string | null): MusicProvider {
  const base = mode === "subsonic" && creds ? new SubsonicProvider(creds) : mode === "ytdlp" ? new YtDlpProvider(ytdlpUrl) : (mock ??= new MockProvider())
  // Signed-in profile: likes and user playlists live on the Decibel server, per profile.
  return withOffline(withPodcasts(profile ? withProfile(base) : base), sourceScope(base.kind, creds, ytdlpUrl, profile ?? null))
}

const profileId = (s: ReturnType<typeof useProfile.getState>) => (s.status === "unavailable" ? null : s.user?.id ?? null)

export function getProvider(): MusicProvider {
  const { mode, creds, ytdlpUrl } = useSession.getState()
  return createProvider(mode, creds, ytdlpUrl, profileId(useProfile.getState()))
}

export function useProvider(): MusicProvider {
  const mode = useSession((s) => s.mode)
  const creds = useSession((s) => s.creds)
  const ytdlpUrl = useSession((s) => s.ytdlpUrl)
  const profile = useProfile(profileId)
  return useMemo(() => createProvider(mode, creds, ytdlpUrl, profile), [mode, creds, ytdlpUrl, profile])
}
