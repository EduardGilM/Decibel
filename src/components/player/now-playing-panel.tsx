"use client"

import { ArtistLinks } from "@/components/music/artist-links"
import Link from "next/link"
import { useEffect, useState, type CSSProperties } from "react"
import { cn } from "@/lib/utils"
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
  const desktop = useMediaQuery("(min-width: 1280px)")
  const want = desktop && open && !!track
  // mounted: in the DOM (kept during the closing slide); expanded: at full width. A panel restored open on load
  // starts expanded with no transition; only later toggles animate.
  const [mounted, setMounted] = useState(want)
  const [expanded, setExpanded] = useState(want)
  const [animate, setAnimate] = useState(false)
  useEffect(() => {
    if (want) {
      setMounted(true)
      setAnimate(true)
      let second = 0
      const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setExpanded(true)) })
      return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
    }
    setAnimate(true)
    setExpanded(false)
    const timer = setTimeout(() => setMounted(false), PANEL_MS)
    return () => clearTimeout(timer)
  }, [want])
  if (!mounted) return null
  return (
    // The column itself slides its width (the main view reflows with it) and gives back the 8 px row gap when closed.
    <div
      className={cn("hidden shrink-0 overflow-hidden [--np-w:340px] xl:flex min-[1600px]:[--np-w:400px]", animate && "transition-[width,margin] duration-[280ms] ease-out motion-reduce:transition-none")}
      style={{ width: expanded ? "var(--np-w)" : 0, marginLeft: expanded ? 0 : -8 }}
    >
      <div className={cn("h-full w-(--np-w) shrink-0", animate && "transition-[opacity,transform] duration-[280ms] ease-out motion-reduce:transition-none", expanded ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0")}>
        <PanelBody />
      </div>
    </div>
  )
}

/** Panel open/close slide (ms). */
const PANEL_MS = 280

function PanelBody() {
  const track = usePlayer((s) => s.queue[s.index])
  const lyricsOpen = usePlayer((s) => s.lyricsOpen)
  const tint = useNowPlayingTint()
  if (!track) return null
  return (
    <aside aria-label="Sonando ahora" className="relative h-full w-full min-w-0 overflow-hidden rounded-2xl bg-card">
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
            <Cover key={`cover:${track.id}`} coverArt={track.coverArt} alt={track.album} size={600} rounded="lg" className="w-full shadow-2xl shadow-black/40" />
            <div className="flex items-start justify-between gap-2">
              <div key={`title:${track.id}`} className="min-w-0 flex-1 animate-fade-in motion-reduce:animate-none">
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
