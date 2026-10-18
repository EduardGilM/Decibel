"use client"

import Link from "next/link"
import { Play, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { LikedCover } from "@/components/layout/app-sidebar"
import { Cover } from "@/components/music/cover"
import { AlbumCard, ArtistCard, hrefAlbum, hrefPlaylist, PlaylistCard } from "@/components/music/media-card"
import { Shelf, ShelfSkeleton } from "@/components/music/shelf"
import { ErrorState } from "@/components/music/states"
import { TopBar } from "@/components/music/top-bar"
import { useState } from "react"
import { FilterChips } from "@/components/music/filter-chips"
import { Grid } from "@/components/music/shelf"
import { getProvider } from "@/lib/providers"
import { useData } from "@/lib/use-data"
import { usePlayer } from "@/stores/player"
import { useRecentAlbums } from "@/stores/history"
import { ContinueListening, FollowedPodcasts } from "@/components/podcast/home-podcasts"
import { TopPodcasts } from "@/components/podcast/top-podcasts"
import { usePodcastsEnabled } from "@/components/podcast/podcast-playback"

function QuickTile({ href, title, art, onPlay }: { href: string; title: string; art: React.ReactNode; onPlay?: () => void }) {
  return (
    <div className="group/tile relative flex h-14 items-center overflow-hidden rounded-md bg-foreground/[0.07] transition-colors duration-150 hover:bg-foreground/[0.14] md:h-16">
      <Link href={href} className="flex h-full min-w-0 flex-1 items-center gap-3 pr-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="h-full">{art}</div>
        <span className="line-clamp-2 min-w-0 text-[13px] font-semibold break-words hyphens-auto md:text-sm">{title}</span>
      </Link>
      {onPlay && (
        <Button
          size="icon"
          aria-label={`Reproducir ${title}`}
          className="mr-2 hidden size-10 shrink-0 rounded-full opacity-0 transition-opacity group-hover/tile:opacity-100 focus-visible:opacity-100 [@media(hover:hover)]:inline-flex"
          onClick={onPlay}
        >
          <Play className="ml-0.5 fill-current" />
        </Button>
      )}
    </div>
  )
}

type HomeFilter = "all" | "playlists" | "podcasts" | "albums" | "artists"

const FILTERS: { value: HomeFilter; label: string }[] = [
  { value: "all", label: "Todo" },
  { value: "playlists", label: "Playlists" },
  { value: "podcasts", label: "Podcasts" },
  { value: "albums", label: "Álbumes" },
  { value: "artists", label: "Artistas" },
]

export default function HomePage() {
  const { data, error, loading } = useData("home", (p) => p.getHome())
  const [filter, setFilter] = useState<HomeFilter>("all")
  const podcastsEnabled = usePodcastsEnabled()
  const filters = podcastsEnabled ? FILTERS : FILTERS.filter((f) => f.value !== "podcasts")
  const show = (f: HomeFilter) => filter === "all" || filter === f
  const albums = data?.newest.filter((album) => !album.id.startsWith("yt-album:")) ?? []
  // Real listening history first; the server's "recent" list only until you have listened to something.
  const listened = useRecentAlbums()
  const recent = listened.length ? listened : data?.recent ?? []

  return (
    <div className="@container">
      <TopBar leadingAvatar />
      <div className="flex flex-col gap-8 pt-4 md:pt-3">
        <FilterChips value={filter} onChange={setFilter} options={filters} className="-mb-3 px-4 md:px-6" extra={<WrappedChip />} />
        {filter === "all" && (
          <section className="grid grid-cols-2 gap-2 px-4 md:px-6 @xl:grid-cols-3 @3xl:grid-cols-4">
            <QuickTile href="/liked/" title="Tus me gusta" art={<LikedCover className="h-full" />} />
            {loading && Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-md md:h-16" />)}
            {data?.playlists.slice(0, 3).map((p) => (
              <QuickTile
                key={p.id}
                href={hrefPlaylist(p.id)}
                title={p.name}
                art={<Cover coverArt={p.coverArt} alt={p.name} size={120} rounded="sm" className="h-full" />}
                onPlay={async () => usePlayer.getState().playList((await getProvider().getPlaylist(p.id)).tracks ?? [], 0, `playlist:${p.id}`)}
              />
            ))}
            {data && recent.slice(0, 4).map((a) => (
              <QuickTile
                key={a.id}
                href={hrefAlbum(a.id)}
                title={a.name}
                art={<Cover coverArt={a.coverArt} alt={a.name} size={120} rounded="sm" className="h-full" />}
                onPlay={async () => usePlayer.getState().playList((await getProvider().getAlbum(a.id)).tracks ?? [], 0, `album:${a.id}`)}
              />
            ))}
          </section>
        )}

        {(filter === "all" || filter === "podcasts") && <ContinueListening />}
        {filter === "podcasts" && <FollowedPodcasts />}
        {filter === "podcasts" && <TopPodcasts />}

        {error && <ErrorState error={error} />}
        {loading && (
          <>
            <ShelfSkeleton />
            <ShelfSkeleton />
          </>
        )}
        {data && filter === "playlists" && (
          <section className="flex flex-col gap-2">
            <h2 className="px-4 text-xl font-semibold tracking-tight md:px-6">Tus playlists</h2>
            <Grid>
              {data.playlists.map((p) => (
                <PlaylistCard key={p.id} playlist={p} />
              ))}
            </Grid>
          </section>
        )}
        {data && filter === "artists" && (
          <section className="flex flex-col gap-2">
            <h2 className="px-4 text-xl font-semibold tracking-tight md:px-6">Artistas</h2>
            <Grid>
              {data.artists.map((a) => (
                <ArtistCard key={a.id} artist={a} />
              ))}
            </Grid>
          </section>
        )}
        {data && (filter === "all" || filter === "albums") && (
          <>
            {show("albums") && recent.length > 0 && (
              <Shelf title="Escuchado recientemente" href={listened.length ? "/history/" : undefined}>
                {recent.map((a) => (
                  <AlbumCard key={a.id} album={a} />
                ))}
              </Shelf>
            )}
            {albums.length > 0 && (
              <Shelf title="Álbumes" href="/library/">
                {albums.map((album) => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </Shelf>
            )}
            {filter === "all" && data.playlists.length > 0 && (
              <Shelf title="Tus playlists" href="/library/">
                {data.playlists.map((p) => (
                  <PlaylistCard key={p.id} playlist={p} />
                ))}
              </Shelf>
            )}
            {filter === "all" && <FollowedPodcasts />}
            {filter === "all" && data.artists.length > 0 && (
              <Shelf title="Artistas" href="/library/">
                {data.artists.map((a) => (
                  <ArtistCard key={a.id} artist={a} />
                ))}
              </Shelf>
            )}
            {data.frequent.length > 0 && (
              <Shelf title="Lo que más escuchas">
                {data.frequent.map((a) => (
                  <AlbumCard key={a.id} album={a} />
                ))}
              </Shelf>
            )}
            {data.random.length > 0 && <Shelf title="Descubre algo al azar">
              {data.random.map((a) => (
                <AlbumCard key={a.id} album={a} />
              ))}
            </Shelf>}
          </>
        )}
      </div>
    </div>
  )
}

/** Inicio → Wrapped: a link, not a filter; a subtle accent gradient sets it apart from the plain chips. */
function WrappedChip() {
  return (
    <Link
      href="/wrapped/"
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[linear-gradient(115deg,color-mix(in_oklab,var(--primary)_42%,transparent),color-mix(in_oklab,var(--primary)_12%,transparent)_70%)] px-4 text-[13px] font-medium text-foreground ring-1 ring-primary/25 transition-colors duration-150 ring-inset hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Sparkles className="size-3.5" aria-hidden />
      Wrapped
    </Link>
  )
}

