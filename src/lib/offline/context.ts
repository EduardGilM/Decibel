"use client"

import { useProfile } from "@/stores/profile"
import { useSession } from "@/stores/session"
import { profileServerBase } from "../profile/session-token"
import type { DataSource } from "../types"
import { downloadScope } from "./policy"

type Credentials = ReturnType<typeof useSession.getState>["creds"]
export function sourceScope(source: DataSource, creds: Credentials, musicUrl: string, profile: string | null) {
  const server = source === "subsonic" ? creds?.serverUrl ?? "" : source === "ytdlp" ? musicUrl || profileServerBase() || (typeof window !== "undefined" ? window.location.origin : "") : "demo"
  return downloadScope(source, server, profile, source === "subsonic" ? creds?.username : undefined)
}

export function useOfflineScope() {
  const mode = useSession((s) => s.mode)
  const creds = useSession((s) => s.creds)
  const musicUrl = useSession((s) => s.ytdlpUrl)
  const profile = useProfile((s) => s.status === "unavailable" ? null : s.user?.id ?? null)
  return sourceScope(mode ?? "mock", creds, musicUrl, profile)
}
