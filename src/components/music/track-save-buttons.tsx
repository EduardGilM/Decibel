"use client"

import { CircleCheck, CirclePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useProvider } from "@/lib/providers"
import type { Track } from "@/lib/types"
import { cn } from "@/lib/utils"
import { usePlaylistPicker } from "@/stores/playlist-picker"
import { useInPlaylist } from "@/stores/playlist-membership"
import { LikeButton } from "./like-button"

export function TrackSaveButtons({ track, className, buttonClassName }: { track: Track; className?: string; buttonClassName?: string }) {
  const provider = useProvider()
  const saved = useInPlaylist(provider.createPlaylist && provider.addToPlaylist && !track.podcast ? track : undefined)
  if (track.podcast) return null // episodes are followed per programme and keep their own progress
  return (
    <div className={cn("flex shrink-0 items-center", className)} onKeyDown={(event) => event.stopPropagation()}>
      <LikeButton id={track.id} initial={track.starred} className={cn("rounded-full", buttonClassName)} />
      {provider.createPlaylist && provider.addToPlaylist && (
        <Button variant="ghost" size="icon" aria-label={saved ? `${track.title} está en tus listas: añadir a otra` : `Añadir ${track.title} a una lista`} aria-haspopup="dialog" data-saved={saved || undefined} className={cn("rounded-full", saved ? "text-primary hover:text-primary" : "text-muted-foreground", buttonClassName)} onClick={(event) => {
          event.stopPropagation()
          const picker = usePlaylistPicker.getState()
          if (picker.track && picker.trigger === event.currentTarget) picker.close()
          else picker.show(track, event.currentTarget)
        }}>
          {saved ? <CircleCheck className="fill-current [&>path]:stroke-background" /> : <CirclePlus />}
        </Button>
      )}
    </div>
  )
}
