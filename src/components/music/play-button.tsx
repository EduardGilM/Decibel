"use client"

import { Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Track } from "@/lib/types"
import { usePlayer } from "@/stores/player"

/** Big round primary play button. Plays `tracks` or toggles if this list is already playing. */
export function PlayButton({ tracks, label, className, size = "lg" }: { tracks?: Track[]; label?: string; className?: string; size?: "md" | "lg" }) {
  const isPlaying = usePlayer((s) => s.isPlaying)
  const sourceLabel = usePlayer((s) => s.sourceLabel)
  const active = !!label && sourceLabel === label
  const playing = active && isPlaying
  return (
    <Button
      size="icon"
      aria-label={playing ? "Pausar" : "Reproducir"}
      disabled={!tracks?.length}
      className={cn("rounded-full", size === "lg" ? "size-14 [&_svg:not([class*='size-'])]:size-6" : "size-11 [&_svg:not([class*='size-'])]:size-5", className)}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (active) usePlayer.getState().toggle()
        else if (tracks?.length) usePlayer.getState().playList(tracks, 0, label)
      }}
    >
      {playing ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />}
    </Button>
  )
}
