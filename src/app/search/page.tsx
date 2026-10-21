"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { SearchX } from "lucide-react"
import { Suspense, useMemo, useSyncExternalStore } from "react"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { FilterChips } from "@/components/music/filter-chips"
import { ArtistAvatar, Cover } from "@/components/music/cover"
import { AlbumCard, ArtistCard, hrefAlbum, hrefArtist } from "@/components/music/media-card"
import { Grid, GridSkeleton, Shelf, ShelfSkeleton } from "@/components/music/shelf"
import { EmptyState, ErrorState } from "@/components/music/states"
import { TopBar } from "@/components/music/top-bar"
import { TrackList, TrackListSkeleton } from "@/components/music/track-list"
import { fromSource } from "@/lib/listen-history"
import { useData } from "@/lib/use-data"
import type { SearchFilter, Track } from "@/lib/types"
import { useHistory } from "@/stores/history"
import { useSession } from "@/stores/session"
import { searchHref, useSearch } from "@/stores/search"
import { PodcastResults } from "@/components/podcast/podcast-search"
import { TopPodcasts } from "@/components/podcast/top-podcasts"
import { usePodcastsEnabled } from "@/components/podcast/podcast-playback"

const GENRE_COLORS = ["#1f6f5c", "#7a3b69", "#2b4c7e", "#a4502c", "#5b5f97", "#3d6b35", "#8c6d1f", "#6b2737", "#22577a", "#4a4e69"]

function Browse({ onPick }: { onPick: (g: string) => void }) {
  const { data, loading } = useData("genres", (p) => p.getGenres())
  return (
    <section className="flex flex-col gap-3 px-4 md:px-6">
      <h2 className="text-xl font-semibold tracking-tight">Explorar por género</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {loading && Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        {data?.map((g, i) => (
          <button
            key={g.name}
            type="button"
            onClick={() => onPick(g.name)}
            className="flex h-24 flex-col justify-between rounded-xl p-3 text-left text-white outline-none transition-opacity duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring md:h-28"
            style={{ backgroundColor: GENRE_COLORS[i % GENRE_COLORS.length] }}
          >
            <span className="text-lg font-bold">{g.name}</span>
            <span className="text-xs text-white/80">{g.albumCount} álbumes</span>
          </button>
        ))}
      </div>
    </section>
  )
}

const subscribe = () => () => {}
/** History lives in localStorage: render it only on the client to avoid a hydration mismatch. */
const useMounted = () => useSyncExternalStore(subscribe, () => true, () => false)

/** Songs from the real listening history (same store as /history), newest first, one row per song. Nothing if empty. */
function RecentListens({ singleTrack }: { singleTrack: boolean }) {
  const mounted = useMounted()
  const entries = useHistory((s) => s.entries)
  const mode = useSession((s) => s.mode)
  const tracks = useMemo(() => {
    const seen = new Set<string>()
    const out: Track[] = []
    for (const { track } of [...fromSource(entries, mode)].sort((a, b) => b.playedAt - a.playedAt)) {
      if (seen.has(track.id)) continue
      seen.add(track.id)
      out.push(track)
      if (out.length >= 30) break
    }
    return out
  }, [entries, mode])
  if (!mounted || !tracks.length) return null
  return (
    <section className="flex flex-col gap-1 px-2 md:px-4" aria-label="Escuchadas recientemente">
      <h2 className="px-2 text-sm font-semibold text-muted-foreground">Escuchadas recientemente</h2>
      <TrackList tracks={tracks} label="search-recent" numbered={false} showAlbum={false} singleTrack={singleTrack} />
    </section>
  )
}

function SearchView() {
  const params = useSearchParams()
  const router = useRouter()
  // the input lives in the top bar (TopSearch); the URL is the source of truth
  const q = params.get("q") ?? ""
  const setQ = (v: string) => {
    useSearch.getState().setQ(v)
    router.replace(searchHref(v), { scroll: false })
  }
  const isYouTube = useSession((s) => s.mode === "ytdlp")
  const podcastsEnabled = usePodcastsEnabled()
  const requestedTab = params.get("type")
  const tab = requestedTab === "tracks" || requestedTab === "albums" || requestedTab === "artists" || (requestedTab === "podcasts" && podcastsEnabled) ? requestedTab : "all"
  const setTab = (type: SearchFilter | "podcasts") => router.replace(searchHref(q, type), { scroll: false })
  const searchType: SearchFilter = isYouTube && (tab === "tracks" || tab === "albums" || tab === "artists") ? tab : "all"
  // Only submitted searches reach the URL; the draft already has its debounce in TopSearch.
  const query = q.trim()
  const { data, error, loading } = useData(query && tab !== "podcasts" ? `search:${searchType}:${query}` : null, (p) => p.search(query, undefined, searchType))

  const empty = data && (tab === "tracks" ? !data.tracks.length : tab === "albums" ? !data.albums.length : tab === "artists" ? !data.artists.length : !data.artists.length && !data.albums.length && !data.tracks.length)
  const top = data?.artists[0] ? { kind: "Artista" as const, item: data.artists[0] } : data?.albums[0] ? { kind: "Álbum" as const, item: data.albums[0] } : null

  return (
    <div>
      <TopBar title="Buscar" leadingAvatar searchPlaceholder="Buscar" />
      <div className="pt-4">
        {!query && podcastsEnabled && (
          <FilterChips
            className="mb-4 px-4 md:px-6"
            value={tab === "podcasts" ? "podcasts" : "all"}
            onChange={setTab}
            options={[{ value: "all", label: "Todo" }, { value: "podcasts", label: "Podcasts" }]}
          />
        )}
        {!query && tab === "podcasts" && (
          <div className="flex flex-col gap-8">
            <TopPodcasts />
          </div>
        )}
        {!query && tab !== "podcasts" && (
          <div className="flex flex-col gap-8">
            <RecentListens singleTrack={isYouTube} />
            {!isYouTube && <Browse onPick={setQ} />}
          </div>
        )}
        {query && (
          <FilterChips
            className="mb-4 px-4 md:px-6"
            value={tab}
            onChange={setTab}
            options={[
              { value: "all", label: "Todo" },
              { value: "tracks", label: "Canciones" },
              { value: "albums", label: "Álbumes" },
              { value: "artists", label: "Artistas" },
              ...(podcastsEnabled ? [{ value: "podcasts" as const, label: "Podcasts" }] : []),
            ]}
          />
        )}
        {query && tab === "podcasts" && <PodcastResults query={query} />}
        {error && <ErrorState error={error} />}
        {query && loading && tab !== "podcasts" && (tab === "albums" || tab === "artists" ? <GridSkeleton round={tab === "artists"} /> : <div className="flex flex-col gap-6"><div className="px-2 md:px-4"><TrackListSkeleton rows={6} /></div>{tab === "all" && <ShelfSkeleton />}</div>)}
        {empty && (
          <EmptyState icon={SearchX} title={`Sin ${tab === "albums" ? "álbumes" : tab === "tracks" ? "canciones" : tab === "artists" ? "artistas" : "resultados"} para «${query}»`}>
            Revisa la ortografía o prueba con otras palabras.
          </EmptyState>
        )}
        {data && !empty && (
          <div className="flex flex-col gap-4">
            {tab === "all" && isYouTube && (
              <div className="flex flex-col gap-6">
                {data.tracks.length > 0 && (
                  <div className="px-2 md:px-4">
                    <TrackList tracks={data.tracks.slice(0, 6)} label={`search:${query}`} numbered={false} showAlbum={false} singleTrack />
                  </div>
                )}
                {data.artists.length > 0 && (
                  <Shelf title="Artistas">
                    {data.artists.map((artist) => <ArtistCard key={artist.id} artist={artist} />)}
                  </Shelf>
                )}
                {data.albums.length > 0 && (
                  <Shelf title="Álbumes">
                    {data.albums.map((album) => <AlbumCard key={album.id} album={album} />)}
                  </Shelf>
                )}
              </div>
            )}
            {tab === "all" && !isYouTube && (
            <div className="flex flex-col gap-8">
              <div className="grid gap-6 px-4 md:px-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                {top && (
                  <section className="flex flex-col gap-2">
                    <h2 className="text-xl font-semibold tracking-tight">Resultado principal</h2>
                    <Card className="gap-4 rounded-xl bg-secondary/50 p-5 ring-0 transition-colors hover:bg-secondary">
                      <Link href={top.kind === "Artista" ? hrefArtist(top.item.id) : hrefAlbum(top.item.id)} className="flex flex-col gap-4 outline-none">
                        {top.kind === "Artista" ? (
                          <ArtistAvatar coverArt={top.item.coverArt} name={top.item.name} className="w-24" />
                        ) : (
                          <Cover coverArt={top.item.coverArt} alt={top.item.name} className="w-24" />
                        )}
                        <div>
                          <div className="text-3xl font-bold tracking-tight">{top.item.name}</div>
                          <div className="text-sm text-muted-foreground">{top.kind}</div>
                        </div>
                      </Link>
                    </Card>
                  </section>
                )}
                {data.tracks.length > 0 && (
                  <section className="flex min-w-0 flex-col gap-2">
                    <h2 className="text-xl font-semibold tracking-tight">Canciones</h2>
                    <TrackList tracks={data.tracks.slice(0, 4)} label={`search:${query}`} numbered={false} showAlbum={false} />
                  </section>
                )}
              </div>
              {data.albums.length > 0 && (
                <Shelf title="Álbumes">
                  {data.albums.map((a) => (
                    <AlbumCard key={a.id} album={a} />
                  ))}
                </Shelf>
              )}
              {data.artists.length > 0 && (
                <Shelf title="Artistas">
                  {data.artists.map((a) => (
                    <ArtistCard key={a.id} artist={a} />
                  ))}
                </Shelf>
              )}
            </div>
            )}
            {tab === "tracks" && (
            <div className="px-2 md:px-4">
              <TrackList tracks={data.tracks} label={`search:${query}`} numbered={false} showAlbum={!isYouTube} singleTrack={isYouTube} />
            </div>
            )}
            {tab === "albums" && (
              <Grid>
                {data.albums.map((a) => (
                  <AlbumCard key={a.id} album={a} />
                ))}
              </Grid>
            )}
            {tab === "artists" && (
              <Grid>
                {data.artists.map((a) => (
                  <ArtistCard key={a.id} artist={a} />
                ))}
              </Grid>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchView />
    </Suspense>
  )
}
