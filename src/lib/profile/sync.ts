"use client"

import { useEffect, useState } from "react"
import type { HistoryEntry } from "@/lib/listen-history"
import { createProvider } from "@/lib/providers"
import type { DataSource, Playlist, Starred, Track } from "@/lib/types"
import { clearDataCache, invalidateDataCache } from "@/lib/use-data"
import { useHistory } from "@/stores/history"
import { useLikes, usePlayer } from "@/stores/player"
import { useProfile, type ProfileUser } from "@/stores/profile"
import { useSession } from "@/stores/session"
import { migrateSettings, useSettings } from "@/stores/settings"
import { api } from "./api"
import { isDeviceList } from "./provider"

const OWNER = "decibel-history-owner"
const DEVICE_HISTORY = "decibel-device-history"
const IMPORTED = "decibel-imported"

type SyncedSettings = { crossfade: number; gapless: boolean; normalize: boolean; defaults: number }
const pickSettings = ({ crossfade, gapless, normalize, defaults }: SyncedSettings): SyncedSettings => ({ crossfade, gapless, normalize, defaults })

/** Stop playback and drop caches so the next profile starts clean. */
export function resetForProfile() {
  usePlayer.getState().audio?.pause()
  usePlayer.setState({ queue: [], original: [], index: 0, isPlaying: false, buffering: false, position: 0, duration: 0, sourceLabel: undefined })
  useLikes.setState({ overrides: {} })
  clearDataCache()
}

/**
 * The local history store becomes a cache of the signed-in profile's history. History recorded
 * before profiles existed is set aside once (for the import prompt) instead of being mixed in.
 */
function adoptHistory(user: ProfileUser) {
  const owner = localStorage.getItem(OWNER)
  if (owner === user.id) return
  const entries = useHistory.getState().entries
  if (!owner && entries.length && !localStorage.getItem(DEVICE_HISTORY)) localStorage.setItem(DEVICE_HISTORY, JSON.stringify(entries))
  useHistory.setState({ entries: [] })
  localStorage.setItem(OWNER, user.id)
}

/** Signed out: set pre-profile history aside (once) and empty the visible history. */
export function stashHistory() {
  const entries = useHistory.getState().entries
  if (!localStorage.getItem(OWNER) && entries.length && !localStorage.getItem(DEVICE_HISTORY)) localStorage.setItem(DEVICE_HISTORY, JSON.stringify(entries))
  if (entries.length) useHistory.setState({ entries: [] })
}

/** Keeps history and playback settings of the signed-in profile in sync with the server. */
export function useProfileSync() {
  const user = useProfile((s) => (s.status === "ready" ? s.user : null))
  const mode = useSession((s) => s.mode)

  useEffect(() => {
    if (!user || !mode) return
    adoptHistory(user)
    let alive = true
    let applying = true
    api<HistoryEntry[]>(`/api/me/history?source=${mode}&limit=500`)
      .then((entries) => { if (alive) { applying = true; useHistory.setState({ entries }); applying = false } })
      .catch(() => {})
      .finally(() => { applying = false })

    // New or updated listens go to the server (idempotent per track + time).
    let last = ""
    const unsubscribe = useHistory.subscribe((state) => {
      const entry = state.entries[0]
      if (applying || !entry) return
      const signature = `${entry.id}:${entry.listened}`
      if (signature === last) return
      last = signature
      api("/api/me/history", { method: "POST", body: { source: entry.source ?? mode, track: entry.track, playedAt: entry.playedAt, listened: entry.listened } }).catch(() => {})
    })
    return () => { alive = false; unsubscribe() }
  }, [user, mode])

  // Likes and lists changed on another device (or by an import) appear without reloading.
  useEffect(() => {
    if (!user || !mode) return
    let known: string | undefined
    const check = () => {
      if (document.visibilityState !== "visible") return
      api<{ revision: string }>(`/api/me/revision?source=${mode}`).then(({ revision }) => {
        if (known !== undefined && revision !== known) {
          window.dispatchEvent(new Event("decibel:library-sync"))
          invalidateDataCache()
        }
        known = revision
      }, () => {})
    }
    check()
    const timer = setInterval(check, 15_000)
    window.addEventListener("focus", check)
    document.addEventListener("visibilitychange", check)
    return () => { clearInterval(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check) }
  }, [user, mode])

  useEffect(() => {
    if (!user) return
    let ready = false
    let timer: ReturnType<typeof setTimeout> | undefined
    api<Partial<SyncedSettings>>("/api/me/settings")
      .then((saved) => {
        if (Object.keys(saved).length) {
          // Profiles saved with the old defaults move to the new ones once (and the server is updated).
          const migrated = migrateSettings(saved)
          useSettings.setState(migrated)
          if (migrated !== saved) return api("/api/me/settings", { method: "PUT", body: { settings: pickSettings(useSettings.getState()) } })
        } else return api("/api/me/settings", { method: "PUT", body: { settings: pickSettings(useSettings.getState()) } })
      })
      .catch(() => {})
      .finally(() => { ready = true })
    const unsubscribe = useSettings.subscribe((state) => {
      if (!ready) return
      clearTimeout(timer)
      timer = setTimeout(() => api("/api/me/settings", { method: "PUT", body: { settings: pickSettings(state) } }).catch(() => {}), 800)
    })
    return () => { clearTimeout(timer); unsubscribe() }
  }, [user])
}

// ---- one-time import of what this device had before profiles ----

export interface LocalData {
  source: DataSource
  likes: { kind: "track" | "album" | "artist"; item: unknown }[]
  playlists: { name: string; tracks: Track[] }[]
  history: HistoryEntry[]
}

const imported = (): Record<string, true> => { try { return JSON.parse(localStorage.getItem(IMPORTED) ?? "{}") } catch { return {} } }
export const markImported = (source: DataSource) => localStorage.setItem(IMPORTED, JSON.stringify({ ...imported(), [source]: true }))

/** Likes, own playlists and listens found on this device for the current source (null if nothing or already imported). */
export async function findLocalData(): Promise<LocalData | null> {
  const { mode, creds, ytdlpUrl } = useSession.getState()
  if (!mode || imported()[mode]) return null
  const device = createProvider(mode, creds, ytdlpUrl) // without profile: the device's own data
  const [starred, lists] = await Promise.all([
    // Demo likes are random sample data, not the user's.
    mode === "mock" ? Promise.resolve<Starred>({ tracks: [], albums: [], artists: [] }) : device.getStarred().catch((): Starred => ({ tracks: [], albums: [], artists: [] })),
    device.getPlaylists().then((all) => all.filter((p) => isDeviceList(mode, p))).catch(() => [] as Playlist[]),
  ])
  const playlists = await Promise.all(lists.map(async (p) => ({ name: p.name, tracks: (await device.getPlaylist(p.id).catch(() => p)).tracks ?? [] })))
  let history: HistoryEntry[] = []
  try { history = (JSON.parse(localStorage.getItem(DEVICE_HISTORY) ?? "[]") as HistoryEntry[]).filter((e) => !e.source || e.source === mode) } catch {}
  const strip = <T extends { starred?: boolean }>(item: T) => ({ ...item, starred: undefined })
  const likes = [
    ...starred.tracks.map((item) => ({ kind: "track" as const, item: strip(item) })),
    ...starred.albums.map((item) => ({ kind: "album" as const, item: strip({ ...item, tracks: undefined }) })),
    ...starred.artists.map((item) => ({ kind: "artist" as const, item: strip({ ...item, albums: undefined, topTracks: undefined }) })),
  ]
  if (!likes.length && !playlists.length && !history.length) { markImported(mode); return null }
  return { source: mode, likes, playlists, history }
}

export async function importLocalData(data: LocalData) {
  const result = await api<{ likes: number; playlists: number; history: number }>("/api/me/import", { method: "POST", body: data })
  markImported(data.source)
  const rest = (JSON.parse(localStorage.getItem(DEVICE_HISTORY) ?? "[]") as HistoryEntry[]).filter((e) => e.source && e.source !== data.source)
  if (rest.length) localStorage.setItem(DEVICE_HISTORY, JSON.stringify(rest))
  else localStorage.removeItem(DEVICE_HISTORY)
  const fresh = await api<HistoryEntry[]>(`/api/me/history?source=${data.source}&limit=500`).catch(() => null)
  if (fresh) useHistory.setState({ entries: fresh })
  invalidateDataCache()
  return result
}

/** Offers the import once per device and source, right after a profile is ready. */
export function useLocalImport() {
  const ready = useProfile((s) => s.status === "ready" && !!s.user)
  const mode = useSession((s) => s.mode)
  const [data, setData] = useState<LocalData | null>(null)
  useEffect(() => {
    if (!ready || !mode) return
    let alive = true
    findLocalData().then((found) => alive && setData(found)).catch(() => {})
    return () => { alive = false }
  }, [ready, mode])
  return { data, dismiss: () => setData(null) }
}
