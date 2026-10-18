"use client"

import { useSearchParams } from "next/navigation"
import { Suspense, useMemo, useSyncExternalStore } from "react"
import { CollectionHeader, HeaderSkeleton } from "@/components/music/collection-header"
import { LikeButton } from "@/components/music/like-button"
import { AlbumCard, ArtistCard } from "@/components/music/media-card"
import { PlayButton } from "@/components/music/play-button"
import { Shelf } from "@/components/music/shelf"
import { ErrorState } from "@/components/music/states"
import { TopBar } from "@/components/music/top-bar"
import { TrackList, TrackListSkeleton } from "@/components/music/track-list"
import { useData } from "@/lib/use-data"
import { artistRecommendations } from "@/lib/artist-recs"
import { fromSource } from "@/lib/listen-history"
import type { Artist, Track } from "@/lib/types"
import { useHistory } from "@/stores/history"
import { useSession } from "@/stores/session"

const subscribe = () => () => {}
const useMounted = () => useSyncExternalStore(subscribe, () => true, () => false)

/** «Recomendadas para ti»: only this artist’s songs (unheard first) + «Artistas similares» as a separate shelf. */
function Recommended({ artist }: { artist: Artist }) {
  const mounted = useMounted()
  const { data, loading } = useData(`artist-recs:${artist.id}`, (p) => p.getArtistRecommendations ? p.getArtistRecommendations(artist.id) : Promise.resolve({ tracks: [], artists: [] }))
  const entries = useHistory((s) => s.entries)
  const mode = useSession((s) => s.mode)
  const recs = useMemo(() => {
    const history: Track[] = mounted ? [...fromSource(entries, mode)].sort((a, b) => b.playedAt - a.playedAt).map((e) => e.track) : []
    return artistRecommendations(artist, data, history)
  }, [artist, data, entries, mode, mounted])
  if (loading && !data) return <TrackListSkeleton rows={3} />
  if (!recs.tracks.length && !recs.artists.length) return null
  return (
    <>
      {recs.tracks.length > 0 && (
        <section className="flex flex-col gap-2 px-2 md:px-4" aria-label="Recomendadas para ti">
          <h2 className="px-2 text-xl font-semibold tracking-tight">Recomendadas para ti</h2>
          <TrackList tracks={recs.tracks} label={`artist-recs:${artist.id}`} numbered={false} showAlbum />
        </section>
      )}
      {recs.artists.length > 0 && (
        <Shelf title="Artistas similares">
          {recs.artists.map((a) => <ArtistCard key={a.id} artist={a} />)}
        </Shelf>
      )}
    </>
  )
}

function ArtistView() {
  const id = useSearchParams().get("id")
  const { data: artist, error, loading } = useData(id ? `artist:${id}` : null, (p) => p.getArtist(id!))
  const label = `artist:${id}`
  return (
    <div>
      <TopBar />
      {loading && (
        <>
          <HeaderSkeleton />
          <TrackListSkeleton rows={5} />
        </>
      )}
      {error && <ErrorState error={error} />}
      {artist && (
        <div className="flex flex-col gap-6">
          <CollectionHeader kind="Artista" title={artist.name} coverArt={artist.coverArt} color={artist.color} round meta={<span>{artist.albumCount} álbumes</span>}>
            <PlayButton tracks={artist.topTracks} label={label} />
            <LikeButton id={artist.id} type="artist" initial={artist.starred} size="icon-lg" className="size-12 [&_svg]:size-6!" />
          </CollectionHeader>
          {!!artist.topTracks?.length && (
            <section className="flex flex-col gap-2 px-2 md:px-4">
              <h2 className="px-2 text-xl font-semibold tracking-tight">Populares</h2>
              <TrackList tracks={artist.topTracks} label={label} showAlbum />
            </section>
          )}
          {!!artist.albums?.length && (
            <Shelf title="Discografía">
              {artist.albums.map((a) => (
                <AlbumCard key={a.id} album={a} />
              ))}
            </Shelf>
          )}
          <Recommended artist={artist} />
        </div>
      )}
    </div>
  )
}

export default function ArtistPage() {
  return (
    <Suspense>
      <ArtistView />
    </Suspense>
  )
}
