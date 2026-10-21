"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Shuffle } from "lucide-react"
import { Suspense } from "react"
import { Button } from "@/components/ui/button"
import { CollectionHeader, HeaderSkeleton } from "@/components/music/collection-header"
import { LikeButton } from "@/components/music/like-button"
import { hrefArtist } from "@/components/music/media-card"
import { PlayButton } from "@/components/music/play-button"
import { DownloadButton } from "@/components/offline/download-button"
import { ErrorState } from "@/components/music/states"
import { TopBar } from "@/components/music/top-bar"
import { TrackList, TrackListSkeleton } from "@/components/music/track-list"
import { formatLong } from "@/lib/format"
import { useData } from "@/lib/use-data"
import { usePlayer } from "@/stores/player"

function AlbumView() {
  const id = useSearchParams().get("id")
  const { data: album, error, loading } = useData(id ? `album:${id}` : null, (p) => p.getAlbum(id!))
  const label = `album:${id}`
  return (
    <div>
      <TopBar tintStrength={0} />
      {loading && (
        <>
          <HeaderSkeleton />
          <TrackListSkeleton />
        </>
      )}
      {error && <ErrorState error={error} />}
      {album && (
        <>
          <CollectionHeader
            bleed
            kind="Álbum"
            title={album.name}
            coverArt={album.coverArt}
            color={album.color}
            meta={
              <>
                {album.artistId ? (
                  <Link href={hrefArtist(album.artistId)} className="font-semibold text-foreground hover:underline">
                    {album.artist}
                  </Link>
                ) : (
                  <span className="font-semibold">{album.artist}</span>
                )}
                {album.year && <span>· {album.year}</span>}
                <span>
                  · {album.songCount} canciones, {formatLong(album.duration)}
                </span>
              </>
            }
          >
            <PlayButton tracks={album.tracks} label={label} />
            <DownloadButton tracks={album.tracks} />
            <Button
              variant="ghost"
              size="icon"
              className="size-12 rounded-full text-muted-foreground [&_svg]:size-6!"
              aria-label="Reproducir en aleatorio"
              onClick={() => {
                if (!usePlayer.getState().shuffle) usePlayer.getState().toggleShuffle()
                usePlayer.getState().playList(album.tracks ?? [], Math.floor(Math.random() * (album.tracks?.length ?? 1)), label)
              }}
            >
              <Shuffle />
            </Button>
            <LikeButton id={album.id} type="album" initial={album.starred} size="icon-lg" className="size-12 [&_svg]:size-6!" />
          </CollectionHeader>
          <div className="relative px-2 md:px-4">
            <TrackList albumNumbers tracks={album.tracks ?? []} label={label} showCover={false} showAlbum={false} />
          </div>
        </>
      )}
    </div>
  )
}

export default function AlbumPage() {
  return (
    <Suspense>
      <AlbumView />
    </Suspense>
  )
}
