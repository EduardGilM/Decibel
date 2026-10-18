"use client"

import { useEffect } from "react"
import { migrationOps, parseRows, type RecentRow } from "@/lib/recent-searches"
import { useProfile } from "@/stores/profile"
import { searchScope, useSearch } from "@/stores/search"
import { useSession } from "@/stores/session"
import { api } from "./api"

/** Key of the recent searches being shown: source + server (+ Subsonic user), and the profile when signed in. */
export function recentScope(): { scope: string; legacy: string; userId: string | null } {
  const { mode, creds, ytdlpUrl } = useSession.getState()
  const legacy = searchScope(mode, mode === "subsonic" ? creds?.serverUrl : ytdlpUrl, creds?.username)
  const userId = useProfile.getState().user?.id ?? null
  return { scope: userId ? `${legacy}#${userId}` : legacy, legacy, userId }
}

/** Same as recentScope(), as a hook (re-renders when the session or profile changes). */
export function useRecentScope(): { scope: string; legacy: string } {
  useSession((s) => [s.mode, s.ytdlpUrl, s.creds?.serverUrl, s.creds?.username].join("|"))
  useProfile((s) => s.user?.id)
  const { scope, legacy } = recentScope()
  return { scope, legacy }
}

const MIGRATED = "decibel-recent-migrated"
const migrated = (): Record<string, true> => { try { return JSON.parse(localStorage.getItem(MIGRATED) ?? "{}") } catch { return {} } }

let running: Promise<void> | null = null
let again = false

/** Sends the queued changes (or just reads the list) and adopts the server's list. Safe to call often. */
export function syncRecentSearches(): Promise<void> {
  if (running) { again = true; return running }
  running = (async () => {
    do {
      again = false
      const { scope, legacy, userId } = recentScope()
      const mode = useSession.getState().mode
      if (!userId || !mode || useProfile.getState().status !== "ready") return
      const store = useSearch.getState()
      // First sync of this profile on this device: upload what the device already had (older format too).
      const done = migrated()
      if (!done[scope]) {
        const local = store.recent[legacy] ?? []
        if (local.length) {
          let seq = store.seq
          const ops = migrationOps(local, Date.now() - 60_000, () => ++seq)
          useSearch.setState((state) => ({ seq, queue: { ...state.queue, [scope]: [...ops, ...(state.queue[scope] ?? [])] } }))
        }
      }
      const ops = (useSearch.getState().queue[scope] ?? []).slice(0, 200)
      let rows: RecentRow[]
      try {
        rows = parseRows(ops.length
          ? await api("/api/me/searches", { method: "POST", body: { source: mode, ops } })
          : await api(`/api/me/searches?source=${mode}`))
      } catch { return } // offline: the queue stays and goes up on the next sync
      if (recentScope().scope !== scope) continue // profile or server changed meanwhile
      useSearch.getState().confirm(scope, rows, ops.map((op) => op.n))
      if (!done[scope]) {
        localStorage.setItem(MIGRATED, JSON.stringify({ ...migrated(), [scope]: true }))
        useSearch.setState((state) => { const recent = { ...state.recent }; delete recent[legacy]; return { recent } })
      }
    } while (again)
  })().finally(() => { running = null })
  return running
}

/** Keeps the signed-in profile's recent searches in sync: on start, on changes, on reconnect and on return. */
export function useRecentSearchSync() {
  const ready = useProfile((s) => s.status === "ready" && !!s.user)
  const user = useProfile((s) => s.user?.id)
  const mode = useSession((s) => s.mode)
  useEffect(() => {
    if (!ready || !mode) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const soon = (ms = 400) => { clearTimeout(timer); timer = setTimeout(() => void syncRecentSearches(), ms) }
    soon(0)
    let lastQueue = useSearch.getState().queue
    const unsubscribe = useSearch.subscribe((state) => { if (state.queue !== lastQueue) { lastQueue = state.queue; soon() } })
    const visible = () => { if (document.visibilityState === "visible") soon(0) }
    const online = () => soon(0)
    window.addEventListener("online", online)
    window.addEventListener("focus", online)
    document.addEventListener("visibilitychange", visible)
    const every = setInterval(() => { if (document.visibilityState === "visible") void syncRecentSearches() }, 60_000)
    return () => {
      clearTimeout(timer); clearInterval(every); unsubscribe()
      window.removeEventListener("online", online); window.removeEventListener("focus", online); document.removeEventListener("visibilitychange", visible)
    }
  }, [ready, user, mode])
}
