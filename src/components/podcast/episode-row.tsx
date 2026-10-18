"use client"

import { Check, Loader2, Pause, Play } from "lucide-react"
import { Cover } from "@/components/music/cover"
import { Skeleton } from "@/components/ui/skeleton"
import { podcastCover, type PodcastEpisode } from "@/lib/podcasts"
import { cn } from "@/lib/utils"
import { usePlayer } from "@/stores/player"
import { formatEpisodeDate, formatEpisodeLength, formatRemaining, plainPreview } from "./format"
import { playEpisode, useEpisodeProgress } from "./podcast-playback"

/** Thin progress line (episode rows and cards). */
export function EpisodeProgress({ fraction, className }: { fraction: number; className?: string }) {
  return (
    <div className={cn("h-1 overflow-hidden rounded-full bg-foreground/20", className)} role="progressbar" aria-label="Escuchado" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, fraction * 100)}%` }} />
    </div>
  )
}

/** Play / pause state of one episode in the shared player. */
export function useEpisodeState(id: string) {
  const current = usePlayer((s) => s.queue[s.index]?.id === id)
  const playing = usePlayer((s) => s.isPlaying)
  const buffering = usePlayer((s) => s.buffering)
  return { current, playing: current && playing, buffering: current && playing && buffering }
}

export function toggleEpisode(episode: PodcastEpisode) {
  const player = usePlayer.getState()
  if (player.queue[player.index]?.id === episode.id) player.toggle()
  else playEpisode(episode)
}

export function EpisodePlayIcon({ playing, buffering }: { playing: boolean; buffering: boolean }) {
  if (buffering) return <Loader2 className="animate-spin" />
  return playing ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />
}

/** Episode in a podcast page or in search results: date · length, two lines of notes, progress, play. */
export function EpisodeRow({ episode, showPodcast = false }: { episode: PodcastEpisode; showPodcast?: boolean }) {
  const { current, playing, buffering } = useEpisodeState(episode.id)
  const progress = useEpisodeProgress(episode)
  const date = formatEpisodeDate(episode.publishedAt)
  const length = progress.started ? formatRemaining(progress.duration, progress.position) : formatEpisodeLength(progress.duration)
  const notes = plainPreview(episode.description)
  return (
    <div className="border-b border-white/[0.06] last:border-b-0">
      <button
        type="button"
        onClick={() => toggleEpisode(episode)}
        aria-label={`${playing ? "Pausar" : "Reproducir"} ${episode.title}`}
        className="flex w-full flex-col gap-2 rounded-lg px-2 py-3 text-left outline-none transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring active:bg-muted"
      >
        <div className="flex items-start gap-3">
          {showPodcast && <Cover coverArt={podcastCover(episode)} alt={episode.podcastTitle} size={120} rounded="sm" className="size-14" />}
          <div className="min-w-0 flex-1">
            <div className={cn("line-clamp-2 text-[15px] leading-snug font-semibold", current && "text-primary")}>{episode.title}</div>
            {showPodcast && <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{episode.podcastTitle}</div>}
          </div>
        </div>
        {notes && <p className="line-clamp-2 text-[13px] leading-snug text-muted-foreground">{notes}</p>}
        <div className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background [&_svg]:size-3.5">
            <EpisodePlayIcon playing={playing} buffering={buffering} />
          </span>
          <span className="min-w-0 truncate text-[13px] text-muted-foreground tabular-nums">
            {[date, length].filter(Boolean).join(" · ")}
            {episode.explicit && <span className="ml-1.5 rounded-[3px] bg-muted-foreground/30 px-1 text-[10px] font-semibold text-foreground/80">E</span>}
          </span>
          {progress.started && <EpisodeProgress fraction={progress.fraction} className="w-16 shrink-0" />}
          {progress.completed && (
            <span className="flex shrink-0 items-center gap-1 text-[13px] text-primary">
              <Check className="size-4" /> Escuchado
            </span>
          )}
        </div>
      </button>
    </div>
  )
}

export function EpisodeListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-5 px-2 py-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <div className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      ))}
    </div>
  )
}
