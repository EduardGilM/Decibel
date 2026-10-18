"use client"

import { useRef } from "react"
import { Shelf } from "@/components/music/shelf"
import type { ListeningPage, PodcastFollows } from "@/lib/podcasts"
import { useData } from "@/lib/use-data"
import { EpisodeCard, PodcastCard } from "./podcast-cards"
import { podcasts, usePodcastLive, usePodcastsEnabled } from "./podcast-playback"

/** Keeps showing the previous result while a refreshed key loads (no flicker when an episode is paused). */
function useLatest<T>(value: T | undefined) {
  const last = useRef(value)
  if (value !== undefined) last.current = value
  return value ?? last.current
}

/** Inicio: episodes started and not finished by this profile, most recent first. */
export function ContinueListening() {
  const enabled = usePodcastsEnabled()
  const version = usePodcastLive((s) => s.version)
  const { data } = useData<ListeningPage>(enabled ? `podcast-listening:${version}` : null, () => podcasts.getListening({ completed: false, limit: 12 }))
  const page = useLatest(data)
  if (!enabled || !page?.episodes.length) return null
  return (
    <Shelf title="Continuar escuchando">
      {page.episodes.map((episode) => <EpisodeCard key={episode.id} episode={episode} />)}
    </Shelf>
  )
}

/** Inicio: followed podcasts. */
export function FollowedPodcasts({ title = "Tus podcasts", href = "/library/" }: { title?: string; href?: string }) {
  const enabled = usePodcastsEnabled()
  const { data } = useData<PodcastFollows>(enabled ? "podcast-follows" : null, () => podcasts.getFollows())
  if (!enabled || !data?.podcasts.length) return null
  return (
    <Shelf title={title} href={href}>
      {data.podcasts.map((podcast) => <PodcastCard key={podcast.id} podcast={podcast} />)}
    </Shelf>
  )
}
