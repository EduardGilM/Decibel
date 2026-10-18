"use client"

import { ListVideo, Loader2, Pause, Play, Repeat, Repeat1, RotateCcw, RotateCw, Shuffle, SkipBack, SkipForward, Volume, Volume1, Volume2, VolumeX } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { usePlayer } from "@/stores/player"
import { formatRate, hrefPodcast, SKIP_BACK, SKIP_FORWARD, skipBy, usePodcastPrefs } from "@/components/podcast/podcast-playback"
import { PlayerSlider } from "./player-slider"
import { ACTIVE_TOGGLE, SECONDARY } from "./player-tint"

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function TransportControls({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  const isPlaying = usePlayer((s) => s.isPlaying)
  const buffering = usePlayer((s) => s.buffering)
  const shuffle = usePlayer((s) => s.shuffle)
  const repeat = usePlayer((s) => s.repeat)
  const hasTrack = usePlayer((s) => s.queue.length > 0)
  const podcastId = usePlayer((s) => s.queue[s.index]?.podcast?.podcastId)
  const p = usePlayer.getState
  const lg = size === "lg"
  const side = lg ? "size-12 [&_svg:not([class*='size-'])]:size-6" : "size-9 [&_svg:not([class*='size-'])]:size-[18px]"
  const skip = lg ? "size-14 [&_svg:not([class*='size-'])]:size-8" : "size-9 [&_svg:not([class*='size-'])]:size-5"
  const main = lg ? "size-16 [&_svg:not([class*='size-'])]:size-7" : "size-9 [&_svg:not([class*='size-'])]:size-4"
  if (podcastId) return <PodcastControls podcastId={podcastId} lg={lg} side={side} skip={skip} main={main} className={className} />

  return (
    <div className={cn("flex items-center justify-center", lg ? "w-full justify-between" : "gap-2", className)}>
      <Tip label={shuffle ? "Desactivar aleatorio" : "Activar aleatorio"}>
        <Button variant="ghost" size="icon" aria-pressed={shuffle} aria-label="Aleatorio" className={cn(side, "rounded-full", shuffle ? ACTIVE_TOGGLE : SECONDARY)} onClick={() => p().toggleShuffle()}>
          <Shuffle />
        </Button>
      </Tip>
      <Tip label="Anterior">
        <Button variant="ghost" size="icon" aria-label="Anterior" disabled={!hasTrack} className={cn(skip, "rounded-full")} onClick={() => p().prev()}>
          <SkipBack className="fill-current" />
        </Button>
      </Tip>
      <Tip label={isPlaying ? "Pausar" : "Reproducir"}>
        <Button
          variant="default"
          size="icon"
          aria-label={isPlaying ? "Pausar" : "Reproducir"}
          disabled={!hasTrack}
          className={cn(main, "rounded-full bg-foreground text-background hover:bg-foreground/85")}
          onClick={() => p().toggle()}
        >
          {buffering && isPlaying ? <Loader2 className="animate-spin" /> : isPlaying ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />}
        </Button>
      </Tip>
      <Tip label="Siguiente">
        <Button variant="ghost" size="icon" aria-label="Siguiente" disabled={!hasTrack} className={cn(skip, "rounded-full")} onClick={() => p().next()}>
          <SkipForward className="fill-current" />
        </Button>
      </Tip>
      <Tip label={repeat === "off" ? "Repetir todo" : repeat === "all" ? "Repetir una" : "No repetir"}>
        <Button variant="ghost" size="icon" aria-pressed={repeat !== "off"} aria-label={repeat === "off" ? "Activar repetir toda la cola" : repeat === "all" ? "Activar repetir canción" : "Desactivar repetición"} className={cn(side, "rounded-full", repeat !== "off" ? ACTIVE_TOGGLE : SECONDARY)} onClick={() => p().cycleRepeat()}>
          {repeat === "one" ? <Repeat1 /> : <Repeat />}
        </Button>
      </Tip>
    </div>
  )
}

/** Episode transport: speed, −15 s, play, +30 s, programme page. */
function PodcastControls({ podcastId, lg, side, skip, main, className }: { podcastId: string; lg: boolean; side: string; skip: string; main: string; className?: string }) {
  const isPlaying = usePlayer((s) => s.isPlaying)
  const buffering = usePlayer((s) => s.buffering)
  const rate = usePodcastPrefs((s) => s.rate)
  const p = usePlayer.getState
  const jump = (Icon: typeof RotateCcw, seconds: number) => (
    <span className="relative flex items-center justify-center">
      <Icon className={lg ? "size-9 stroke-[1.6]" : "size-6 stroke-[1.8]"} />
      <span className={cn("absolute font-bold tabular-nums", lg ? "pt-0.5 text-[10px]" : "pt-px text-[8px]")}>{seconds}</span>
    </span>
  )
  return (
    <div className={cn("flex items-center justify-center", lg ? "w-full justify-between" : "gap-2", className)}>
      <Tip label="Velocidad de reproducción">
        <Button variant="ghost" size="icon" aria-label={`Velocidad ${formatRate(rate)}`} className={cn(side, "rounded-full font-semibold tabular-nums", lg ? "text-[15px]" : "text-xs", rate !== 1 ? ACTIVE_TOGGLE : SECONDARY)} onClick={() => usePodcastPrefs.getState().cycleRate()}>
          {formatRate(rate)}
        </Button>
      </Tip>
      <Tip label={`Retroceder ${SKIP_BACK} s`}>
        <Button variant="ghost" size="icon" aria-label={`Retroceder ${SKIP_BACK} segundos`} className={cn(skip, "rounded-full")} onClick={() => skipBy(-SKIP_BACK)}>
          {jump(RotateCcw, SKIP_BACK)}
        </Button>
      </Tip>
      <Tip label={isPlaying ? "Pausar" : "Reproducir"}>
        <Button variant="default" size="icon" aria-label={isPlaying ? "Pausar" : "Reproducir"} className={cn(main, "rounded-full bg-foreground text-background hover:bg-foreground/85")} onClick={() => p().toggle()}>
          {buffering && isPlaying ? <Loader2 className="animate-spin" /> : isPlaying ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />}
        </Button>
      </Tip>
      <Tip label={`Avanzar ${SKIP_FORWARD} s`}>
        <Button variant="ghost" size="icon" aria-label={`Avanzar ${SKIP_FORWARD} segundos`} className={cn(skip, "rounded-full")} onClick={() => skipBy(SKIP_FORWARD)}>
          {jump(RotateCw, SKIP_FORWARD)}
        </Button>
      </Tip>
      <Tip label="Ver el podcast">
        <Button variant="ghost" size="icon" asChild aria-label="Ver el podcast" className={cn(side, "rounded-full", SECONDARY)}>
          <Link href={hrefPodcast(podcastId)} onClick={() => p().setFullOpen(false)}><ListVideo /></Link>
        </Button>
      </Tip>
    </div>
  )
}

export function SeekBar({ className, compact }: { className?: string; compact?: boolean }) {
  const position = usePlayer((s) => s.position)
  const duration = usePlayer((s) => s.duration)
  const [drag, setDrag] = useState<number | null>(null)
  const value = Math.min(drag ?? position, duration || 0)
  const time = "text-[11px] leading-none text-foreground/70 tabular-nums"
  const slider = (
    <PlayerSlider
      label="Posición"
      valueText={`${formatTime(value)} de ${formatTime(duration)}`}
      variant={compact ? "full" : "bar"}
      disabled={!duration}
      min={0}
      max={Math.max(1, duration)}
      step={1}
      value={[value]}
      onValueChange={([v]) => setDrag(v)}
      onValueCommit={([v]) => {
        usePlayer.getState().seek(v)
        setDrag(null)
      }}
    />
  )
  if (compact) {
    return (
      <div className={cn("flex w-full flex-col gap-1.5", className)}>
        {slider}
        <div className={cn("flex w-full justify-between", time, "text-xs")}>
          <span>{formatTime(value)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    )
  }
  return (
    <div className={cn("flex w-full items-center gap-2", className)}>
      <span className={cn("w-10 shrink-0 text-right", time)}>{formatTime(value)}</span>
      {slider}
      <span className={cn("w-10 shrink-0", time)}>{formatTime(duration)}</span>
    </div>
  )
}

export function VolumeControl({ className, variant = "bar" }: { className?: string; variant?: "bar" | "full" }) {
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)
  const v = muted ? 0 : volume
  const Icon = v === 0 ? VolumeX : v < 0.34 ? Volume : v < 0.67 ? Volume1 : Volume2
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Tip label={muted ? "Activar sonido" : "Silenciar"}>
        <Button variant="ghost" size="icon" className={cn("rounded-full", SECONDARY)} aria-label="Silenciar" onClick={() => usePlayer.getState().toggleMute()}>
          <Icon />
        </Button>
      </Tip>
      <PlayerSlider label="Volumen" variant={variant} valueText={`${Math.round(v * 100)} %`} className="w-[112px]" min={0} max={100} step={1} value={[Math.round(v * 100)]} onValueChange={([x]) => usePlayer.getState().setVolume(x / 100)} />
    </div>
  )
}
