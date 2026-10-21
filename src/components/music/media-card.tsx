"use client"

import Link from "next/link"
import { Play } from "lucide-react"
import type { CSSProperties, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { getProvider } from "@/lib/providers"
import type { Album, Artist, Playlist, Track } from "@/lib/types"
import { cn } from "@/lib/utils"
import { usePlayer } from "@/stores/player"
import { ArtistAvatar, Cover } from "./cover"

/** Podcast episodes keep their programme as "album": those ids open the podcast page. */
export const hrefAlbum = (id: string) => `/${id.startsWith("podcast:") ? "podcast" : "album"}/?id=${encodeURIComponent(id)}`
export const hrefArtist = (id: string) => `/artist/?id=${encodeURIComponent(id)}`
export const hrefPlaylist = (id: string) => `/playlist/?id=${encodeURIComponent(id)}`

function QuickPlay({ load, label, className }: { load: () => Promise<Track[]>; label: string; className?: string }) {
  return (
    <Button
      size="icon"
      aria-label={`Reproducir ${label}`}
      className={cn(
        "absolute right-2 bottom-2 size-11 rounded-full opacity-0 transition-all duration-200 scale-90 group-hover/media:opacity-100 group-hover/media:scale-100 focus-visible:opacity-100 focus-visible:scale-100 [@media(hover:none)]:hidden [&_svg]:size-5",
        className,
      )}
      onClick={async (e) => {
        e.preventDefault()
        e.stopPropagation()
        const tracks = await load()
        usePlayer.getState().playList(tracks, 0, label)
      }}
    >
      <Play className="ml-0.5 fill-current" />
    </Button>
  )
}

type CardAppearance = { className?: string; style?: CSSProperties }

function MediaCardBase({ href, title, subtitle, art, play, className, style }: { href: string; title: string; subtitle: ReactNode; art: ReactNode; play?: ReactNode } & CardAppearance) {
  return (
    <Card style={style} className={cn("group/media gap-0 rounded-xl bg-transparent p-2 py-2 ring-0 transition-all duration-200 hover:bg-muted/60 hover:scale-[1.02] active:bg-muted active:scale-[0.98] animate-fade-in", className)}>
      <Link href={href} className="flex flex-col gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="relative overflow-hidden rounded-lg">
          {art}
          {play}
        </div>
        <div className="min-w-0 px-0.5 pb-1">
          <div className="truncate text-sm font-medium">{title}</div>
          <div className="line-clamp-2 text-[13px] text-muted-foreground">{subtitle}</div>
        </div>
      </Link>
    </Card>
  )
}

export function AlbumCard({ album, className, style }: { album: Album } & CardAppearance) {
  return (
    <MediaCardBase
      className={className}
      style={style}
      href={hrefAlbum(album.id)}
      title={album.name}
      subtitle={[album.year, album.artist].filter(Boolean).join(" · ")}
      art={<Cover coverArt={album.coverArt} alt={album.name} />}
      play={<QuickPlay label={`album:${album.id}`} load={async () => (await getProvider().getAlbum(album.id)).tracks ?? []} />}
    />
  )
}

export function PlaylistCard({ playlist, className, style }: { playlist: Playlist } & CardAppearance) {
  return (
    <MediaCardBase
      className={className}
      style={style}
      href={hrefPlaylist(playlist.id)}
      title={playlist.name}
      subtitle={playlist.comment || `${playlist.songCount} canciones`}
      art={<Cover coverArt={playlist.coverArt} alt={playlist.name} />}
      play={<QuickPlay label={`playlist:${playlist.id}`} load={async () => (await getProvider().getPlaylist(playlist.id)).tracks ?? []} />}
    />
  )
}

export function ArtistCard({ artist, className, style }: { artist: Artist } & CardAppearance) {
  return (
    <MediaCardBase
      className={className}
      style={style}
      href={hrefArtist(artist.id)}
      title={artist.name}
      subtitle="Artista"
      art={<ArtistAvatar coverArt={artist.coverArt} name={artist.name} className="w-full" />}
      play={<QuickPlay label={`artist:${artist.id}`} load={async () => (await getProvider().getArtist(artist.id)).topTracks ?? []} />}
    />
  )
}
