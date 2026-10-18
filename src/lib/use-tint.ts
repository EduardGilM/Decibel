"use client"

import { useProvider } from "@/lib/providers"
import { useCoverColor } from "@/lib/use-color"
import { usePlayer } from "@/stores/player"

/** Colour of the currently playing artwork, for the translucent player tint. */
export function useNowPlayingTint() {
  const provider = useProvider()
  const coverArt = usePlayer((s) => s.queue[s.index]?.coverArt)
  return useCoverColor(provider.coverUrl(coverArt, 64), provider.coverColor?.(coverArt))
}

export const tintStyle = (color: string | undefined, pct = 24) => (color ? { backgroundColor: `color-mix(in oklab, ${color} ${pct}%, transparent)` } : undefined)

/** Album-colour tint strength for the glass playback surfaces (desktop bar + mobile mini player). */
export const PLAYER_TINT = 32
