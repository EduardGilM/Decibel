"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Loader2, Rss, SearchX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Shelf, ShelfSkeleton } from "@/components/music/shelf"
import { EmptyState } from "@/components/music/states"
import { ApiError } from "@/lib/profile/api"
import type { PodcastSearch } from "@/lib/podcasts"
import { useData } from "@/lib/use-data"
import { EpisodeListSkeleton, EpisodeRow } from "./episode-row"
import { PodcastCard } from "./podcast-cards"
import { hrefPodcast, podcasts } from "./podcast-playback"

const looksLikeFeed = (q: string) => /^https?:\/\/\S+$/i.test(q)

function errorText(error: Error) {
  if (error instanceof ApiError && error.status === 429) return "Demasiadas búsquedas seguidas. Espera un minuto y vuelve a probar."
  return error.message
}

/** Pasting the RSS address of a podcast opens it directly (also for feeds that are not in the directory). */
function OpenFeed({ url }: { url: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-start gap-3 px-4 py-6 md:px-6">
      <div className="flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-md bg-foreground/10"><Rss className="size-6" /></span>
        <div className="min-w-0">
          <div className="font-semibold">Abrir feed RSS</div>
          <div className="max-w-[70vw] truncate text-sm text-muted-foreground">{url}</div>
        </div>
      </div>
      <Button className="rounded-full" disabled={busy} onClick={async () => {
        setBusy(true)
        setError(null)
        try {
          const page = await podcasts.importFeed(url)
          router.push(hrefPodcast(page.podcast.id))
        } catch (e) {
          setError(e instanceof Error ? errorText(e) : "No se pudo abrir el feed")
        } finally {
          setBusy(false)
        }
      }}>
        {busy && <Loader2 className="animate-spin" />}Abrir
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

/** «Podcasts» tab of Buscar: programmes (directory + feeds already known) and matching episodes. */
export function PodcastResults({ query }: { query: string }) {
  const feed = looksLikeFeed(query)
  const { data, error, loading } = useData<PodcastSearch>(query && !feed ? `podcast-search:${query}` : null, () => podcasts.search(query, { kind: "all", limit: 20 }))
  if (feed) return <OpenFeed url={query} />
  if (error) return <EmptyState icon={SearchX} title="No se pudo buscar podcasts">{errorText(error)}</EmptyState>
  if (loading) return (
    <div className="flex flex-col gap-6">
      <ShelfSkeleton />
      <EpisodeListSkeleton rows={4} />
    </div>
  )
  if (!data) return null
  if (!data.podcasts.length && !data.episodes.length) return (
    <EmptyState icon={SearchX} title={`Sin podcasts para «${query}»`}>Prueba con el nombre del programa o pega la dirección de su feed RSS.</EmptyState>
  )
  return (
    <div className="flex flex-col gap-6 pb-4">
      {data.podcasts.length > 0 && (
        <Shelf title="Podcasts">
          {data.podcasts.map((podcast) => <PodcastCard key={podcast.id} podcast={podcast} />)}
        </Shelf>
      )}
      {data.episodes.length > 0 && (
        <section className="flex flex-col px-2 md:px-4" aria-label="Episodios">
          <h2 className="px-2 pb-1 text-xl font-semibold tracking-tight">Episodios</h2>
          {data.episodes.map((episode) => <EpisodeRow key={episode.id} episode={episode} showPodcast />)}
        </section>
      )}
    </div>
  )
}
