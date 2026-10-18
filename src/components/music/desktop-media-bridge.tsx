"use client"

import { useEffect } from "react"
import { isDesktopApp } from "@/stores/app-update"
import { sizedArtwork } from "@/lib/artwork-size"
import { usePlayer } from "@/stores/player"

/** Windows downloads the cover itself, without the session: only public https artwork (catalogue/podcast images). */
const publicCover = (cover?: string) => (cover && /^https:\/\//.test(cover) ? sizedArtwork(cover, 512) : null)

type Action = "previous" | "play" | "pause" | "toggle" | "next" | "mute"

/**
 * Desktop app ↔ OS media controls. On Windows the shell shows taskbar thumbnail buttons (previous,
 * play/pause, next, mute) and the system media controls (Win11 media flyout, keyboard media keys); it
 * gets the current state from here and sends button presses back as `decibel://media` events.
 */
export function DesktopMediaBridge() {
  useEffect(() => {
    if (!isDesktopApp()) return
    let alive = true
    let unlisten: (() => void) | undefined
    let last = ""
    void (async () => {
      const [{ invoke }, { listen }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")])
      if (!alive) return
      const send = () => {
        const s = usePlayer.getState()
        const track = s.queue[s.index]
        const state = { playing: !!track && s.isPlaying, muted: s.muted, hasTrack: !!track, title: track?.title ?? null, artist: track?.artist ?? null, album: track?.album ?? null, cover: publicCover(track?.coverArt) }
        const key = JSON.stringify(state)
        if (key === last) return
        last = key
        void invoke("media_state", { state }).catch(() => {})
      }
      send()
      const unsubscribe = usePlayer.subscribe(send)
      const stop = await listen<Action>("decibel://media", ({ payload }) => {
        const player = usePlayer.getState()
        if (payload === "previous") player.prev()
        else if (payload === "next") void player.next()
        else if (payload === "mute") player.toggleMute()
        else if (payload === "toggle" || (payload === "play" && !player.isPlaying) || (payload === "pause" && player.isPlaying)) player.toggle()
      })
      unlisten = () => { unsubscribe(); stop() }
      if (!alive) unlisten()
    })().catch(() => {})
    return () => { alive = false; unlisten?.() }
  }, [])
  return null
}
