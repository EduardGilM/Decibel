"use client"

import { create } from "zustand"
import { sessionHeaders } from "../profile/session-token.ts"

export const OFFLINE_GRACE_MS = 120_000
// Transport failures affect retries immediately; the visible app survives short outages.
export const useConnection = create<{ offline: boolean; showDownloads: boolean }>(() => ({
  offline: typeof navigator !== "undefined" && navigator.onLine === false,
  showDownloads: false,
}))
export const isOffline = () => useConnection.getState().offline || (typeof navigator !== "undefined" && navigator.onLine === false)
let recheck: (() => Promise<void>) | undefined
/** Media failures also probe the server, without waiting for the periodic connectivity check. */
export const checkConnection = () => recheck?.() ?? Promise.resolve()

/** A reachable server may still require login. Only a sustained outage replaces the current view. */
export function monitorConnection(base: string, changed?: () => void) {
  let disposed = false
  let active: AbortController | undefined
  let fallback: ReturnType<typeof setTimeout> | undefined
  useConnection.setState({ offline: false, showDownloads: false })
  // Device heartbeats can also report transport loss. They share this same grace period.
  const unsubscribe = useConnection.subscribe((state, previous) => {
    if (state.offline === previous.offline) return
    clearTimeout(fallback)
    fallback = undefined
    if (state.offline) {
      fallback = setTimeout(() => {
        if (!disposed && useConnection.getState().offline) useConnection.setState({ showDownloads: true })
      }, OFFLINE_GRACE_MS)
    } else useConnection.setState({ showDownloads: false })
    changed?.()
  })
  const set = (offline: boolean) => {
    if (disposed || useConnection.getState().offline === offline) return
    useConnection.setState({ offline })
  }
  const check = async () => {
    active?.abort()
    if (navigator.onLine === false) { set(true); return }
    const controller = active = new AbortController()
    try {
      const response = await fetch(`${base}/api/auth/me`, {
        credentials: "include", headers: sessionHeaders(base), cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      })
      if (!controller.signal.aborted) set(response.status >= 500)
    } catch { if (!controller.signal.aborted) set(true) }
  }
  const offline = () => { active?.abort(); set(true) }
  const wake = () => { if (document.visibilityState === "visible") void check() }
  window.addEventListener("online", check)
  window.addEventListener("offline", offline)
  document.addEventListener("visibilitychange", wake)
  // Retry an unavailable server even with the player in the background: no OS online event accompanies
  // a server recovering, and prepared audio should carry on without having to reopen the app.
  const timer = setInterval(() => { if (useConnection.getState().offline || document.visibilityState === "visible") void check() }, 20_000)
  recheck = check
  void check()
  return () => {
    disposed = true; active?.abort(); clearInterval(timer); clearTimeout(fallback); unsubscribe()
    if (recheck === check) recheck = undefined
    window.removeEventListener("online", check)
    window.removeEventListener("offline", offline)
    document.removeEventListener("visibilitychange", wake)
  }
}
