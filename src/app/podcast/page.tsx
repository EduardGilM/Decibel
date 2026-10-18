"use client"

import { useSearchParams } from "next/navigation"
import { Suspense, useState } from "react"
import { Loader2, Podcast as PodcastIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CollectionHeader, HeaderSkeleton } from "@/components/music/collection-header"
import { EmptyState, ErrorState } from "@/components/music/states"
import { TopBar } from "@/components/music/top-bar"
import { EpisodeListSkeleton, EpisodePlayIcon, EpisodeRow, toggleEpisode, useEpisodeState } from "@/components/podcast/episode-row"
import { FollowButton } from "@/components/podcast/podcast-cards"
import { podcasts, usePodcastsEnabled } from "@/components/podcast/podcast-playback"
import { plainPreview } from "@/components/podcast/format"
import { podcastCover, type PodcastEpisode, type PodcastPage } from "@/lib/podcasts"
import { useData } from "@/lib/use-data"

const PAGE = 50

/** Big play button: the episode in progress, otherwise the newest one not heard yet. */
function PlayLatest({ episodes }: { episodes: PodcastEpisode[] }) {
  const pick = episodes.find((e) => !e.progress.completed && e.progress.position >= 5) ?? episodes.find((e) => !e.progress.completed) ?? episodes[0]
  const { playing, buffering } = useEpisodeState(pick?.id ?? "")
  return (
    <Button size="icon" disabled={!pick} aria-label={playing ? "Pausar" : `Reproducir ${pick?.title ?? ""}`} className="size-14 rounded-full [&_svg]:size-6" onClick={() => pick && toggleEpisode(pick)}>
      <EpisodePlayIcon playing={playing} buffering={buffering} />
    </Button>
  )
}

function About({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const preview = plainPreview(text)
  if (!preview) return null
  return (
    <button type="button" onClick={() => setOpen(!open)} className="px-4 pb-2 text-left text-sm leading-relaxed text-muted-foreground outline-none md:px-6" aria-expanded={open}>
      <span className={open ? "whitespace-pre-line" : "line-clamp-3"}>{open ? text.trim() : preview}</span>
      {!open && preview.length > 160 && <span className="font-semibold text-foreground"> Más</span>}
    </button>
  )
}

function PodcastView() {
  const id = useSearchParams().get("id")
  const enabled = usePodcastsEnabled()
  const { data, error, loading } = useData<PodcastPage>(id && enabled ? `podcast:${id}` : null, () => podcasts.getPodcast(id!, { limit: PAGE }))
  const [more, setMore] = useState<{ key: string; episodes: PodcastEpisode[] }>({ key: "", episodes: [] })
  const [loadingMore, setLoadingMore] = useState(false)
  const extra = more.key === id ? more.episodes : []
  const episodes = data ? [...data.episodes, ...extra] : []

  if (!enabled) return (
    <div>
      <TopBar />
      <EmptyState icon={PodcastIcon} title="Podcasts con tu perfil">Entra con tu perfil de Decibel para escuchar podcasts y guardar por dónde vas.</EmptyState>
    </div>
  )
  return (
    <div>
      <TopBar />
      {loading && (
        <>
          <HeaderSkeleton />
          <EpisodeListSkeleton />
        </>
      )}
      {error && <ErrorState error={error} />}
      {data && (
        <>
          <CollectionHeader
            kind="Podcast"
            title={data.podcast.title}
            coverArt={podcastCover(data.podcast)}
            meta={
              <>
                {data.podcast.author && <span className="font-semibold">{data.podcast.author}</span>}
                <span>{data.podcast.author ? "· " : ""}{data.total} episodios</span>
              </>
            }
          >
            <PlayLatest episodes={data.episodes} />
            <FollowButton id={data.podcast.id} following={data.following} className="ml-1" />
          </CollectionHeader>
          <About text={data.podcast.description} />
          {data.stale && <p className="px-4 pb-2 text-xs text-muted-foreground md:px-6">No se ha podido actualizar el feed; se muestran los últimos episodios guardados.</p>}
          <section className="px-2 pb-6 md:px-4" aria-label="Episodios">
            <h2 className="px-2 pt-2 pb-1 text-xl font-semibold tracking-tight">Episodios</h2>
            {episodes.map((episode) => <EpisodeRow key={episode.id} episode={episode} />)}
            {!episodes.length && <p className="px-2 py-6 text-sm text-muted-foreground">Este podcast todavía no tiene episodios.</p>}
            {episodes.length < data.total && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="outline"
                  className="h-9 rounded-full border-foreground/40 bg-transparent px-5 text-[13px] font-semibold"
                  disabled={loadingMore}
                  onClick={async () => {
                    setLoadingMore(true)
                    try {
                      const page = await podcasts.getPodcast(id!, { limit: PAGE, offset: episodes.length })
                      setMore({ key: id!, episodes: [...extra, ...page.episodes] })
                    } catch { /* the button stays to retry */ } finally {
                      setLoadingMore(false)
                    }
                  }}
                >
                  {loadingMore && <Loader2 className="animate-spin" />}
                  Cargar más episodios
                </Button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

export default function PodcastPageRoute() {
  return (
    <Suspense>
      <PodcastView />
    </Suspense>
  )
}
