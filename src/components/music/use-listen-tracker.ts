"use client"

import { useEffect } from "react"
import { accumulate, shouldRecord } from "@/lib/listen-history"
import { useHistory } from "@/stores/history"
import { usePlayer } from "@/stores/player"

/** Heard time of a recorded listen is pushed again every this many seconds of extra listening. */
export const LISTEN_UPDATE_STEP = 20

/**
 * Records a history entry once per playback after ~30 s (or half a short song) of real listening,
 * then keeps that entry's heard time up to date (every 20 s and when the playback ends) so minutes
 * listened are real (Wrapped). The server keeps MAX(listened) for the same track + time.
 */
export function useListenTracker() {
  useEffect(() => {
    let playback = -1, id = "", heard = 0, last = 0, entry = "", saved = 0
    const flush = () => {
      if (entry && heard - saved >= 1) { saved = heard; useHistory.getState().update(entry, heard) }
    }
    const unsubscribe = usePlayer.subscribe((s) => {
      const track = s.queue[s.index]
      if (!track || track.podcast) { flush(); entry = ""; playback = -1; id = ""; return } // episodes keep their own progress (Continuar escuchando)
      if (s.playbackId !== playback || track.id !== id) {
        flush()
        playback = s.playbackId; id = track.id; heard = 0; last = s.position; entry = ""; saved = 0
        return
      }
      const playing = s.isPlaying && !s.buffering
      heard = accumulate(heard, last, s.position, playing)
      last = s.position
      if (!entry && shouldRecord(heard, s.duration || track.duration)) {
        entry = useHistory.getState().record(track, heard)
        saved = heard
      } else if (entry && (heard - saved >= LISTEN_UPDATE_STEP || (!playing && heard - saved >= 1))) flush()
    })
    const hide = () => { if (document.visibilityState === "hidden") flush() }
    document.addEventListener("visibilitychange", hide)
    window.addEventListener("pagehide", flush)
    return () => { flush(); unsubscribe(); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", flush) }
  }, [])
}
