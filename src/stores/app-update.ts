"use client"

import { create } from "zustand"
import { androidProgress, androidUpdate, dayKey, installDesktopUpdate, snoozed, updateBase, type AndroidUpdate, type DesktopUpdateLike, type UpdatePhase } from "../lib/app-update.ts"
import { APP_VERSION } from "../lib/version.ts"

export type UpdateOffer = { kind: "android"; version: string; apk: AndroidUpdate } | { kind: "desktop"; version: string; update: DesktopUpdateLike }
export type { UpdatePhase }

const SNOOZE = "decibel-update-snooze"
const CHECK_EVERY = 15 * 60_000
const CHECK_COOLDOWN = 60_000
const CHECK_TIMEOUT = 15_000

interface UpdateState {
  offer: UpdateOffer | null
  open: boolean
  phase: UpdatePhase
  /** 0–1 while downloading when the size is known */
  progress: number | null
  /** why the last attempt failed (phase "error") */
  error: string | null
  lastCheck: number
  check: () => Promise<void>
  show: () => void
  later: () => void
  start: () => Promise<void>
  /** Android: back from «Instalar apps desconocidas», open the installer with the APK already downloaded */
  resume: () => void
  /** Android: give up while waiting for the permission */
  cancel: () => void
}

export const isNativeApp = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
export const isDesktopApp = () => isNativeApp() && !window.DecibelNative

/** Fallback only (shell without the update bridge, or the user asks for it after an error): /download in the browser. */
export function openDownloads() {
  const url = `${updateBase()}/download`
  if (window.DecibelNative?.openUrl) window.DecibelNative.openUrl(url)
  else window.open(url, "_blank", "noopener")
}

let poll: ReturnType<typeof setInterval> | null = null
let checking = false
const stopPoll = () => { if (poll) clearInterval(poll); poll = null }
const busy = (phase: UpdatePhase) => phase === "downloading" || phase === "installing" || phase === "permission"
const closeOffer = (offer: UpdateOffer | null) => {
  if (offer?.kind === "desktop") void offer.update.close?.().catch(() => {})
}

/**
 * App updates (native apps only; the browser never sees any of this). «Actualizar» updates in place: Android
 * downloads the APK in the shell, checks its sha256 and opens the system installer (asking for «Instalar apps
 * desconocidas» first if needed); desktop uses the signed Tauri updater and relaunches. The modal opens by
 * itself once per version and day; /download stays as a fallback.
 */
export const useAppUpdate = create<UpdateState>()((set, get) => ({
  offer: null, open: false, phase: "idle", progress: null, error: null, lastCheck: 0,
  async check() {
    if (!isNativeApp() || checking || busy(get().phase) || navigator.onLine === false) return
    const base = updateBase()
    if (!base) return
    checking = true
    set({ lastCheck: Date.now() })
    try {
      let offer: UpdateOffer | null = null
      if (window.DecibelNative) {
        const res = await fetch(`${base}/api/app/version`, { cache: "no-store", signal: AbortSignal.timeout(CHECK_TIMEOUT) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const apk = androidUpdate(await res.json(), APP_VERSION, base)
        if (apk) offer = { kind: "android", version: apk.version, apk }
      } else {
        const { check } = await import("@tauri-apps/plugin-updater")
        const update = await check({ timeout: CHECK_TIMEOUT })
        if (update) offer = { kind: "desktop", version: update.version, update }
      }
      // An install may have started while the request was in flight.
      if (busy(get().phase)) { closeOffer(offer); return }
      const previous = get().offer
      if (!offer) set({ offer: null, open: false })
      else {
        const fresh = previous?.version !== offer.version
        set({ offer, open: get().open || (fresh && !snoozed(localStorage.getItem(SNOOZE), offer.version)) })
      }
      closeOffer(previous)
    } catch { /* offline or no updater configured: next check */ }
    finally { checking = false }
  },
  show: () => { if (get().offer) set({ open: true }) },
  later() {
    const offer = get().offer
    if (offer) localStorage.setItem(SNOOZE, JSON.stringify({ version: offer.version, day: dayKey() }))
    if (!busy(get().phase)) set({ open: false, phase: "idle", error: null })
  },
  async start() {
    const offer = get().offer
    if (!offer || busy(get().phase)) return
    set({ phase: "downloading", progress: null, error: null, open: true })
    if (offer.kind === "android") {
      const shell = window.DecibelNative
      if (!shell?.installUpdate?.(offer.apk.url, offer.apk.sha256, offer.version)) { set({ phase: "idle" }); openDownloads(); return }
      stopPoll()
      poll = setInterval(() => {
        const next = androidProgress(shell.updateStatus?.())
        if (!next) return
        set({ phase: next.phase, progress: next.progress, error: next.message ?? null })
        if (next.phase === "installing") { stopPoll(); setTimeout(() => set({ phase: "idle", progress: null, open: false }), 2500) }
        if (next.phase === "error") stopPoll()
      }, 300)
      return
    }
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process")
      await installDesktopUpdate(offer.update, relaunch, (p) => set({ phase: p.phase, progress: p.progress }))
    } catch (error) {
      set({ phase: "error", progress: null, error: error instanceof Error ? error.message : String(error || "") || null })
    }
  },
  cancel() { stopPoll(); set({ phase: "idle", progress: null, error: null, open: false }) },
  resume() {
    if (get().phase !== "permission") return
    const shell = window.DecibelNative
    if (shell?.canInstallPackages && !shell.canInstallPackages()) return
    shell?.resumeInstall?.()
  },
}))

/** Checks while visible: after start-up, every 15 minutes, on return and on reconnect. */
export function startUpdateChecks(): () => void {
  if (!isNativeApp()) return () => {}
  const run = (reconnected = false) => {
    if (document.visibilityState !== "visible" || navigator.onLine === false) return
    const state = useAppUpdate.getState()
    if (reconnected || !state.lastCheck || Date.now() - state.lastCheck >= CHECK_COOLDOWN) void state.check()
  }
  const first = setTimeout(run, 4000) // never competes with the first screen
  const every = setInterval(run, CHECK_EVERY)
  const back = () => {
    if (document.visibilityState !== "visible") return
    const state = useAppUpdate.getState()
    if (state.phase === "permission") return state.resume() // back from Settings
    run()
  }
  const online = () => run(true) // retry even if a recent request failed while losing the connection
  document.addEventListener("visibilitychange", back)
  window.addEventListener("focus", back)
  window.addEventListener("online", online)
  return () => {
    clearTimeout(first); clearInterval(every)
    document.removeEventListener("visibilitychange", back)
    window.removeEventListener("focus", back)
    window.removeEventListener("online", online)
  }
}
