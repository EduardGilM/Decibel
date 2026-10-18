"use client"

import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Cover } from "@/components/music/cover"
import { podcastCover, type Podcast, type PodcastEpisode } from "@/lib/podcasts"
import { cn } from "@/lib/utils"
import { formatRemaining } from "./format"
import { EpisodePlayIcon, EpisodeProgress, toggleEpisode, useEpisodeState } from "./episode-row"
import { hrefPodcast, podcasts, useEpisodeProgress } from "./podcast-playback"

/** Podcast tile for shelves and grids (same recipe as the album cards). */
export function PodcastCard({ podcast, className }: { podcast: Podcast; className?: string }) {
  return (
    <Card className={cn("group/media gap-0 rounded-xl bg-transparent p-2 py-2 ring-0 transition-colors duration-150 hover:bg-muted/60 active:bg-muted", className)}>
      <Link href={hrefPodcast(podcast.id)} className="flex flex-col gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Cover coverArt={podcastCover(podcast)} alt={podcast.title} />
        <div className="min-w-0 px-0.5 pb-1">
          <div className="line-clamp-2 text-sm font-medium">{podcast.title}</div>
          <div className="truncate text-[13px] text-muted-foreground">{podcast.author || "Podcast"}</div>
        </div>
      </Link>
    </Card>
  )
}

/** "Continuar escuchando": artwork with the progress on it; a tap resumes the episode. */
export function EpisodeCard({ episode, className }: { episode: PodcastEpisode; className?: string }) {
  const { playing, buffering } = useEpisodeState(episode.id)
  const progress = useEpisodeProgress(episode)
  return (
    <Card className={cn("gap-0 rounded-xl bg-transparent p-2 py-2 ring-0 transition-colors duration-150 hover:bg-muted/60 active:bg-muted", className)}>
      <button type="button" onClick={() => toggleEpisode(episode)} aria-label={`${playing ? "Pausar" : "Continuar"} ${episode.title}`} className="flex flex-col gap-2 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="relative">
          <Cover coverArt={podcastCover(episode)} alt={episode.podcastTitle} />
          <span className="absolute right-2 bottom-3.5 flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/40 [&_svg]:size-4">
            <EpisodePlayIcon playing={playing} buffering={buffering} />
          </span>
          <EpisodeProgress fraction={progress.fraction} className="absolute inset-x-2 bottom-1.5 bg-black/50" />
        </div>
        <div className="min-w-0 px-0.5 pb-1">
          <div className="line-clamp-2 text-sm font-medium">{episode.title}</div>
          <div className="truncate text-[13px] text-muted-foreground">{progress.completed ? episode.podcastTitle : formatRemaining(progress.duration, progress.position) || episode.podcastTitle}</div>
        </div>
      </button>
    </Card>
  )
}

/** Pill «Seguir» / «Siguiendo» (optimistic; the server confirms and Tu biblioteca refreshes). */
export function FollowButton({ id, following: initial, className }: { id: string; following: boolean; className?: string }) {
  const [following, setFollowing] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [synced, setSynced] = useState(initial)
  if (synced !== initial) { setSynced(initial); setFollowing(initial) }
  return (
    <Button
      variant="outline"
      aria-pressed={following}
      disabled={busy}
      className={cn("h-8 rounded-full border-foreground/50 bg-transparent px-4 text-[13px] font-semibold hover:border-foreground hover:bg-transparent", following && "border-foreground/30 text-foreground/80", className)}
      onClick={async () => {
        const next = !following
        setFollowing(next)
        setBusy(true)
        try {
          if (next) await podcasts.follow(id)
          else await podcasts.unfollow(id)
        } catch (error) {
          setFollowing(!next)
          toast.error(next ? "No se pudo seguir el podcast" : "No se pudo dejar de seguir", { description: error instanceof Error ? error.message : undefined })
        } finally {
          setBusy(false)
        }
      }}
    >
      {following ? "Siguiendo" : "Seguir"}
    </Button>
  )
}
