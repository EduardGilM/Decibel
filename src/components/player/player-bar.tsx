"use client"

import { ArtistLinks } from "@/components/music/artist-links"
import Link from "next/link"
import { Mic, PanelRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Cover } from "@/components/music/cover"
import { TrackSaveButtons } from "@/components/music/track-save-buttons"
import { hrefAlbum } from "@/components/music/media-card"
import { cn } from "@/lib/utils"
import { usePlayer } from "@/stores/player"
import { useMediaQuery } from "@/hooks/use-media-query"
import { SeekBar, TransportControls, VolumeControl } from "./controls"
import { ACTIVE_TOGGLE, SECONDARY } from "./player-tint"
import { DevicePicker } from "./device-picker"

/** Desktop persistent bottom bar — fixed-colour glass, same recipe as the mobile mini player. */
export function PlayerBar() {
  const track = usePlayer((s) => s.queue[s.index])
  const panelOpen = usePlayer((s) => s.panelOpen)
  const lyricsOpen = usePlayer((s) => s.lyricsOpen)
  const fullOpen = usePlayer((s) => s.fullOpen)
  const fullTab = usePlayer((s) => s.fullTab)
  const desktop = useMediaQuery("(min-width: 1280px)")
  const lyricsActive = !!track && (desktop ? panelOpen && lyricsOpen : fullOpen && fullTab === "lyrics")

  return (
    <footer className="relative hidden h-[76px] shrink-0 overflow-hidden rounded-2xl glass-player md:block">
      <div className="relative grid h-full grid-cols-[1fr_minmax(320px,40%)_1fr] items-center gap-4 px-3">
        <div className="flex min-w-0 items-center gap-3">
          {track ? (
            <>
              <Cover coverArt={track.coverArt} alt={track.album} size={120} className="size-14" />
              <div className="min-w-0">
                <Link href={track.albumId ? hrefAlbum(track.albumId) : "#"} className="block truncate text-sm font-medium hover:underline">
                  {track.title}
                </Link>
                <ArtistLinks track={track} className="block truncate text-xs text-muted-foreground" />
              </div>
              <TrackSaveButtons track={track} />
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Nada sonando</span>
          )}
        </div>
        <div className="flex flex-col items-center">
          <TransportControls />
          <SeekBar className="-mt-1" />
        </div>
        <div className="flex items-center justify-end gap-1">
          <DevicePicker />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" disabled={!track || !!track.podcast} aria-label="Letras" aria-pressed={lyricsActive} className={cn("rounded-full", lyricsActive ? ACTIVE_TOGGLE : SECONDARY)} onClick={() => {
                const player = usePlayer.getState()
                if (desktop) {
                  player.setLyricsOpen(!(player.panelOpen && player.lyricsOpen))
                  player.setPanelOpen(true)
                } else {
                  player.setFullTab("lyrics")
                  player.setFullOpen(true)
                }
              }}>
                <Mic />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Letras</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-pressed={panelOpen}
                aria-label="Panel de reproducción"
                className={cn("hidden rounded-full xl:inline-flex", panelOpen ? ACTIVE_TOGGLE : SECONDARY)}
                onClick={() => usePlayer.getState().setPanelOpen(!panelOpen)}
              >
                <PanelRight />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Panel de reproducción</TooltipContent>
          </Tooltip>
          <VolumeControl />
        </div>
      </div>
    </footer>
  )
}
