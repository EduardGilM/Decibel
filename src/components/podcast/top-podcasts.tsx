"use client"

import { Shelf, ShelfSkeleton } from "@/components/music/shelf"
import type { PodcastTop } from "@/lib/podcasts"
import { useData } from "@/lib/use-data"
import { PodcastCard } from "./podcast-cards"
import { podcasts, usePodcastsEnabled } from "./podcast-playback"

const updated = (t: number | null) => (t ? new Date(t).toLocaleDateString("es-ES", { day: "numeric", month: "long" }) : null)

/**
 * Most listened podcasts in Spain (Apple Podcasts charts through the server, cached for a few hours):
 * overall first, then by category when Apple has that chart. Cards open the podcast page.
 */
export function TopPodcasts({ country = "ES" }: { country?: string }) {
  const enabled = usePodcastsEnabled()
  const { data, error, loading } = useData<PodcastTop>(enabled ? `podcast-top:${country}` : null, () => podcasts.getTop(country))
  if (!enabled) return null
  if (loading && !data)
    return (
      <>
        <ShelfSkeleton />
        <ShelfSkeleton />
      </>
    )
  if (error && !data) return <p className="px-4 text-sm text-muted-foreground md:px-6">No se ha podido cargar el ranking de podcasts. Vuelve a intentarlo en un rato.</p>
  const sections = data?.sections.filter((s) => s.podcasts.length) ?? []
  if (!sections.length) return null
  const date = updated(data?.updatedAt ?? null)
  return (
    <>
      {sections.map((section, i) => (
        <Shelf key={section.id} title={i === 0 && section.id === "all" ? "Más escuchados en España" : section.title}>
          {section.podcasts.map((podcast) => <PodcastCard key={podcast.id} podcast={podcast} />)}
        </Shelf>
      ))}
      <p className="-mt-4 px-4 text-xs text-muted-foreground md:px-6">Ranking de Apple Podcasts en España{date ? ` · actualizado el ${date}` : ""}</p>
    </>
  )
}
