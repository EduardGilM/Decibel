"use client"

import { createInterruption } from "@/lib/audio/interruption"
import { usePlayer } from "@/stores/player"

/** The single interruption controller of this page (Android calls, voice notes, recordings). */
export const interruption = createInterruption({
  audio: () => usePlayer.getState().audio,
  playing: () => usePlayer.getState().isPlaying,
  setPlaying: (value) => usePlayer.getState().setPlaying(value),
})

if (typeof window !== "undefined") {
  // Whatever the user does meanwhile (play, pause, another song) cancels the automatic resume.
  let last = usePlayer.getState()
  usePlayer.subscribe((state) => {
    if (state.isPlaying !== last.isPlaying || state.index !== last.index || state.playbackId !== last.playbackId) interruption.userAction()
    last = state
  })
}
