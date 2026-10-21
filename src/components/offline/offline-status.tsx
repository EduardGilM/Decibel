"use client"

import { useEffect } from "react"
import { WifiOff } from "lucide-react"
import { useConnection, monitorConnection } from "@/lib/offline/connection"
import { reconcileDownloads } from "@/lib/offline/downloads"
import { profileServerBase } from "@/lib/profile/session-token"
import { useSession } from "@/stores/session"
import { useProfile } from "@/stores/profile"

/** The packaged native shell boots locally; this monitor also detects an unreachable Decibel server. */
export function OfflineStatus() {
  const offline = useConnection((s) => s.showDownloads)
  const mode = useSession((s) => s.mode)
  const server = useSession((s) => s.ytdlpUrl)
  useEffect(() => { void reconcileDownloads().catch(() => {}) }, [])
  useEffect(() => monitorConnection(mode === "ytdlp" ? server || profileServerBase() : profileServerBase(), () => {
    if (!useConnection.getState().offline && useProfile.getState().status === "offline") void useProfile.getState().check()
  }), [mode, server])
  if (!offline) return null
  return <p role="status" className="flex items-center gap-2 px-4 pt-3 text-xs text-muted-foreground"><WifiOff aria-hidden="true" className="size-3.5" /> Sin conexión</p>
}
