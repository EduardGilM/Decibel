"use client"

import { ArtistLinks } from "@/components/music/artist-links"
import Link from "next/link"
import type { CSSProperties } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Cover } from "@/components/music/cover"
import { CoverGlow } from "@/components/music/cover-glow"
import { TrackSaveButtons } from "@/components/music/track-save-buttons"
import { hrefAlbum } from "@/components/music/media-card"
import { useNowPlayingTint } from "@/lib/use-tint"
import { usePlayer } from "@/stores/player"
import { useMediaQuery } from "@/hooks/use-media-query"
import { QueueList } from "./queue-list"
import { LyricsPanel } from "./lyrics-panel"

/** «A continuación» card (Spotify style): live, reorderable, own scroll; nothing at all when no song comes next. */
function PanelUpNext() {
  const upcoming = usePlayer((s) => s.queue.length - s.index - 1)
  if (upcoming <= 0) return null
  return (
    <section aria-label="A continuación" className="flex min-h-0 flex-col rounded-xl bg-white/[0.04] pt-3 pb-2">
      <div className="flex items-center justify-between gap-2 px-4 pb-1">
        <h3 className="text-[15px] font-bold">A continuación</h3>
        <Link href="/queue/" className="inline-flex h-7 items-center rounded-full bg-white/[0.08] px-3 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-white/[0.14] hover:text-foreground">Ver cola</Link>
      </div>
      <div className="max-h-[min(420px,50vh)] overflow-y-auto overscroll-contain">
        <QueueList showCurrent={false} heading={false} className="px-2" />
      </div>
    </section>
  )
}

/** Desktop right column (xl+): big artwork over a blurred-cover glow, lyrics preview card, up next. */
export function NowPlayingPanel() {
  const track = usePlayer((s) => s.queue[s.index])
  const open = usePlayer((s) => s.panelOpen)
  const lyricsOpen = usePlayer((s) => s.lyricsOpen)
  const tint = useNowPlayingTint()
  const desktop = useMediaQuery("(min-width: 1280px)")
  if (!desktop || !open || !track) return null
  return (
    <aside aria-label="Sonando ahora" className="relative hidden w-[340px] min-w-0 shrink-0 overflow-hidden rounded-2xl bg-card xl:block min-[1600px]:w-[400px]">
      <ScrollArea className="relative h-full [&>[data-slot=scroll-area-viewport]>div]:block!">
        <div className="relative">
          <CoverGlow coverArt={track.coverArt} height="560px" />
          <div className="relative flex min-w-0 items-center justify-between gap-2 px-4 pt-3 pb-1">
            <Link href={track.albumId ? hrefAlbum(track.albumId) : "#"} className="min-w-0 flex-1 truncate text-[15px] font-bold hover:underline">{track.album}</Link>
            <Button variant="ghost" size="icon" className="rounded-full" aria-label="Cerrar panel" onClick={() => usePlayer.getState().setPanelOpen(false)}>
              <X />
            </Button>
          </div>
          <div className="relative flex flex-col gap-4 px-4 pt-2 pb-4">
            <Cover coverArt={track.coverArt} alt={track.album} size={600} rounded="lg" className="w-full shadow-2xl shadow-black/40" />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="text-2xl leading-tight font-bold tracking-tight break-words">{track.title}</h2>
                <ArtistLinks track={track} className="mt-1 block truncate text-[15px] text-muted-foreground" />
              </div>
              <TrackSaveButtons track={track} className="pt-0.5" />
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {/* Lyrics preview: card with a faint, darkened hint of the cover colour. */}
          {lyricsOpen && !track.podcast && <div className="overflow-hidden rounded-xl bg-(--lyrics-bg) [--lyrics-bg:rgb(255_255_255/0.06)]" style={tint ? { "--lyrics-bg": `color-mix(in oklab, ${tint} 14%, rgb(255 255 255 / 0.05))` } as CSSProperties : undefined}>
            <LyricsPanel track={track} preview scrollable className="px-4 py-4" />
          </div>}
          <PanelUpNext />
        </div>
      </ScrollArea>
    </aside>
  )
}
