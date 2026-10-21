"use client"

import { useEffect } from "react"
import { createBrowseTracker } from "@/lib/browse-history"
import { recentScope, useRecentScope } from "@/lib/profile/search-sync"
import { useBrowse } from "@/stores/browse"
import { usePlayer } from "@/stores/player"

export function useBrowseTracker() {
  const { scope } = useRecentScope()
  useEffect(() => {
    const track = createBrowseTracker((state) => {
      if (recentScope().scope === scope) useBrowse.getState().remember(scope, state)
    })
    const unsubscribe = usePlayer.subscribe((state, previous) => track(state, previous))
    const flush = () => { const state = usePlayer.getState(); track(state, state, true) }
    const hidden = () => { if (document.visibilityState === "hidden") flush() }
    window.addEventListener("pagehide", flush)
    document.addEventListener("visibilitychange", hidden)
    return () => {
      flush(); unsubscribe()
      window.removeEventListener("pagehide", flush)
      document.removeEventListener("visibilitychange", hidden)
    }
  }, [scope])
}
