"use client"

import { ArtistLinks } from "@/components/music/artist-links"
import { ChevronDown, Mic, Pause, Play, Radio, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Cover } from "@/components/music/cover"
import { CoverGlow } from "@/components/music/cover-glow"
import { TrackSaveButtons } from "@/components/music/track-save-buttons"
import { usePlayer, type PlayerTab } from "@/stores/player"
import { SeekBar, TransportControls } from "./controls"
import { QueueList } from "./queue-list"
import { MiniSeek } from "./mini-seek"
import { DevicePicker } from "./device-picker"
import { chipClass } from "@/components/music/filter-chips"
import { LyricsPanel } from "./lyrics-panel"
import { useNowPlayingTint } from "@/lib/use-tint"
import type { Track } from "@/lib/types"
import { useCoverExpansion } from "@/hooks/use-cover-expansion"
import { useMiniSwipe } from "@/hooks/use-mini-swipe"
import { miniNeighbors, type MiniNeighbor } from "@/lib/mini-swipe"
import { useShallow } from "zustand/react/shallow"
import { useMemo, useRef } from "react"

/** Lyrics card under the controls: synced lines with a faint cover tint; tap (or ⤢) opens the full lyrics view. */
function LyricsCard({ track }: { track: Track }) {
  const tint = useNowPlayingTint()
  const expand = () => usePlayer.getState().setFullTab("lyrics")
  return (
    <div
      className="overflow-hidden rounded-2xl bg-(--lyrics-bg) [--lyrics-bg:rgb(255_255_255/0.07)] [&_[data-lyrics-viewport]]:max-h-80"
      style={tint ? { "--lyrics-bg": `color-mix(in oklab, ${tint} 24%, rgb(255 255 255 / 0.04))` } as React.CSSProperties : undefined}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) expand() }}
    >
      <LyricsPanel track={track} preview scrollable title="Letra" onExpand={expand} className="px-5 pt-4 pb-5" />
    </div>
  )
}

/** A song that peeks in from the side while swiping the mini player (no links: it is only a preview). */
function MiniPeek({ neighbor, side, peekRef }: { neighbor: NonNullable<MiniNeighbor>; side: "left" | "right"; peekRef?: React.Ref<HTMLDivElement> }) {
  const track = "track" in neighbor ? neighbor.track : null
  return (
    <div ref={peekRef} aria-hidden className={`pointer-events-none absolute inset-y-0 flex w-max max-w-[60vw] items-center gap-3 ${side === "left" ? "right-full mr-6" : "left-full ml-6"}`}>
      {track ? <Cover coverArt={track.coverArt} alt="" size={100} rounded="sm" className="size-11 shrink-0" />
        : <div className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-white/10"><Radio className="size-5" /></div>}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{track ? track.title : "Radio de YouTube"}</div>
        <div className="flex items-center gap-1 truncate text-[13px] text-foreground/70">
          {"restart" in neighbor && neighbor.restart ? <><RotateCcw className="size-3.5 shrink-0" />Desde el principio</> : track ? track.artist : "Canciones parecidas"}
        </div>
      </div>
    </div>
  )
}

/**
 * Cover + title of the mini player. Tap opens the full player; a horizontal swipe skips (left = next,
 * right = previous, same store actions as the buttons) with the neighbour song peeking in.
 */
function MiniStrip({ track, coverRef, onOpen }: { track: Track; coverRef: React.Ref<HTMLDivElement>; onOpen: () => void }) {
  const view = usePlayer(useShallow((s) => ({
    queue: s.queue, index: s.index, repeat: s.repeat, position: s.position > 3 ? 4 : 0, hasRecommendations: !!s.recommendationLoader,
  })))
  const { next, prev } = useMemo(() => miniNeighbors(view), [view])
  const row = useRef<HTMLDivElement>(null)
  const prevPeek = useRef<HTMLDivElement>(null)
  const { handlers, offset, dragging } = useMiniSwipe({
    hasNext: !!next, hasPrev: !!prev,
    // Neighbours sit 24px (mr-6/ml-6) beside the current song: travel exactly enough to put them where it is.
    distance: (side) => (side === "next" ? row.current?.offsetWidth ?? 0 : prevPeek.current?.offsetWidth ?? 0) + 24,
    onNext: () => { void usePlayer.getState().next() },
    onPrev: () => usePlayer.getState().prev(),
  })
  return (
    // The blank area beside a short title opens the player too (the role=button below is only as wide as its text).
    <div {...handlers} data-mini-player="" data-dragging={dragging || undefined} className="relative min-w-0 flex-1 cursor-pointer touch-pan-y self-stretch overflow-hidden rounded-lg flex items-center"
      onClick={onOpen}>
      <div ref={row} className="relative w-max max-w-full" style={offset ? { transform: `translate3d(${offset}px,0,0)` } : undefined}>
        {/* Only the side being revealed shows its neighbour; at rest nothing peeks. */}
        {prev && offset > 0 && <MiniPeek neighbor={prev} side="left" peekRef={prevPeek} />}
        {/* The whole area opens the player; only the artist text is a link (a link cannot sit inside a button). */}
        <div role="button" tabIndex={0} aria-label="Abrir reproductor" aria-roledescription="Desliza para cambiar de canción" className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring transition-all duration-200"
          onClick={onOpen}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen() } }}>
          <Cover key={`cover:${track.id}`} ref={coverRef} coverArt={track.coverArt} alt={track.album} size={100} rounded="sm" className="size-11 shrink-0" />
          <div key={`title:${track.id}`} className="min-w-0 animate-fade-in motion-reduce:animate-none">
            <div className="truncate text-sm font-medium">{track.title}</div>
            <ArtistLinks track={track} className="block truncate text-[13px] text-foreground/70" />
          </div>
        </div>
        {next && offset < 0 && <MiniPeek neighbor={next} side="right" />}
      </div>
    </div>
  )
}

/** Mobile mini player (sits above the bottom nav) that expands into a full-screen drawer. */

const SCROLL_BLUR = [
  { blur: 2, to: 52 },
  { blur: 5, to: 40 },
  { blur: 10, to: 28 },
  { blur: 18, to: 16 },
]

/** Progressive blur over the top ~52px of the tab content. It also covers the header's own band (56px
 *  above, painted under the header, z-20): starting there, the blur never meets an edge at the header's
 *  bottom, so it cannot smear a hard line. No tint: the cover glow behind stays continuous. */
function ScrollBlur() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-14 z-10 h-[calc(3.5rem+52px)]">
      {SCROLL_BLUR.map(({ blur, to }) => {
        // var(--scroll-blur) goes 0 → 52px once the list has scrolled (globals.css), so at rest nothing below the header is blurred.
        const mask = `linear-gradient(to bottom, #000 calc(3.5rem + var(--scroll-blur) * ${((to * 0.35) / 52).toFixed(3)}), transparent calc(3.5rem + var(--scroll-blur) * ${(to / 52).toFixed(3)}))`
        // opacity var(--scroll-on) (0 at rest): the header band is not blurred at all until the list scrolls. A blurred
        // band at rest showed as a stripe over the cover gradient on Android (0.1.33).
        return <div key={blur} className="absolute inset-0" style={{ opacity: "var(--scroll-on)", backdropFilter: `blur(${blur}px)`, WebkitBackdropFilter: `blur(${blur}px)`, maskImage: mask, WebkitMaskImage: mask }} />
      })}
    </div>
  )
}

/** Content scrolling up under the header fades out (mask on the viewport) only once it has moved, so the
 *  artwork at rest is never clipped; the blur layers above it stay transparent over the cover glow. */
function markScrolled(event: React.UIEvent<HTMLElement>) {
  const viewport = event.target as HTMLElement
  if (viewport.dataset.slot !== "scroll-area-viewport") return
  const scrolled = viewport.scrollTop > 2 ? "true" : "false"
  if (event.currentTarget.dataset.scrolled !== scrolled) event.currentTarget.dataset.scrolled = scrolled
}

export function MobilePlayer() {
  const track = usePlayer((s) => s.queue[s.index])
  const isPlaying = usePlayer((s) => s.isPlaying)
  const fullOpen = usePlayer((s) => s.fullOpen)
  const storedTab = usePlayer((s) => s.fullTab)
  const { miniCover, fullCover, openPlayer, sharedOpen } = useCoverExpansion(track?.id, fullOpen)
  if (!track) return null
  const podcast = !!track.podcast
  const fullTab = podcast && storedTab === "lyrics" ? "now" : storedTab // episodes have no lyrics

  return (
    <>
      <div className="fixed inset-x-2 bottom-[calc(3.5rem+env(safe-area-inset-bottom)+6px)] z-40 overflow-hidden rounded-xl glass-player shadow-lg shadow-black/20 md:hidden">
        {/* pb-3: room for the seek line so its touch zone mostly sits below the controls */}
        <div className="relative flex items-center gap-2 p-1.5 pr-1 pb-3">
          <MiniStrip track={track} coverRef={miniCover} onOpen={openPlayer} />
          {/* Spotify-style: the device picker sits in the mini player (no tab in the bottom bar). */}
          <DevicePicker className="size-10 shrink-0" />
          <TrackSaveButtons track={track} buttonClassName="size-10" />
          <Button variant="ghost" size="icon" className="size-11 [&_svg:not([class*='size-'])]:size-6 transition-transform active:scale-90" aria-label={isPlaying ? "Pausar" : "Reproducir"} onClick={() => usePlayer.getState().toggle()}>
            {isPlaying ? <Pause className="fill-current" /> : <Play className="fill-current" />}
          </Button>
        </div>
        <MiniSeek />
      </div>

      <Drawer open={fullOpen} onOpenChange={(v) => usePlayer.getState().setFullOpen(v)}>
        {/* Full screen from the very top: the artwork glow sits on the sheet itself (behind the status bar and the
            handle), no top border, and the handle goes below the safe area. */}
        <DrawerContent data-cover-expansion={sharedOpen || undefined} className="h-dvh max-h-none! rounded-none! border-0 bg-background p-0 data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:border-t-0 [&>[data-slot=drawer-handle]]:mt-[calc(var(--safe-top)+10px)]">
          <CoverGlow coverArt={track.coverArt} height="78%" />
          <Tabs value={fullTab} onValueChange={(tab) => usePlayer.getState().setFullTab(tab as PlayerTab)} className="relative flex min-h-0 flex-1 flex-col pb-[max(env(safe-area-inset-bottom),16px)]">
            <DrawerHeader className="relative z-20 flex flex-row items-center gap-2 px-3 pt-1 pb-2">
              <Button variant="ghost" size="icon" className="size-11" aria-label="Cerrar reproductor" onClick={() => usePlayer.getState().setFullOpen(false)}>
                <ChevronDown className="size-6" />
              </Button>
              <div className="min-w-0 flex-1 text-center">
                <DrawerTitle className="truncate text-sm">{track.album}</DrawerTitle>
                <DrawerDescription className="sr-only">Reproductor a pantalla completa</DrawerDescription>
              </div>
              <TabsList className="h-auto gap-2 bg-transparent p-0">
                <TabsTrigger value="now" className={`h-8 flex-none ${chipClass}`}>
                  Ahora
                </TabsTrigger>
                <TabsTrigger value="queue" className={`h-8 flex-none ${chipClass}`}>
                  Cola
                </TabsTrigger>
                {!podcast && <TabsTrigger value="lyrics" aria-label="Letras" className={`h-8 flex-none ${chipClass}`}><Mic className="size-4" /></TabsTrigger>}
              </TabsList>
            </DrawerHeader>
            <TabsContent value="now" className="scroll-blur-host relative min-h-0 flex-1">
              <ScrollBlur />
              <ScrollArea className="scroll-fade-top h-full [&>[data-slot=scroll-area-viewport]>div]:block!" onScrollCapture={markScrolled}>
                {/* First screen: artwork + controls. The lyrics card peeks below, Spotify-style. */}
                <div className="flex min-h-[calc(100dvh-7.5rem-var(--safe-top)-max(env(safe-area-inset-bottom),16px))] flex-col justify-end gap-5 px-6 pb-4">
                  <div className="flex min-h-0 flex-1 items-center justify-center">
                    <Cover key={`cover:${track.id}`} ref={fullCover} coverArt={track.coverArt} alt={track.album} size={600} rounded="lg" className="w-full max-w-[min(100%,46dvh)]" />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div key={`title:${track.id}`} className="min-w-0 animate-fade-in motion-reduce:animate-none">
                      <h2 className="truncate text-2xl font-bold">{track.title}</h2>
                      <ArtistLinks track={track} className="block truncate text-foreground/70" onNavigate={() => usePlayer.getState().setFullOpen(false)} />
                    </div>
                    <TrackSaveButtons track={track} buttonClassName="size-11 [&_svg]:size-5" />
                  </div>
                  <SeekBar compact />
                  {/* No volume slider on phones: the hardware buttons own volume. */}
                  <TransportControls size="lg" className="pb-2" />
                  <div className="-mt-4 flex justify-center"><DevicePicker variant="label" /></div>
                </div>
                <div className="flex flex-col gap-3 px-4 pb-6">
                  {!podcast && <LyricsCard track={track} />}
                  <div className="rounded-2xl bg-white/[0.05] py-2">
                    <QueueList showCurrent={false} className="px-2" />
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="queue" className="scroll-blur-host relative min-h-0 flex-1">
              <ScrollBlur />
              <ScrollArea className="scroll-fade-top h-full" onScrollCapture={markScrolled}>
                <QueueList className="p-2" />
              </ScrollArea>
            </TabsContent>
            <TabsContent value="lyrics" className="scroll-blur-host relative min-h-0 flex-1">
              <ScrollBlur />
              <ScrollArea className="scroll-fade-top h-full [&>[data-slot=scroll-area-viewport]>div]:block!" onScrollCapture={markScrolled}>
                <LyricsPanel track={track} className="px-6" />
                <QueueList showCurrent={false} className="px-4 pb-4" />
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </DrawerContent>
      </Drawer>
    </>
  )
}
