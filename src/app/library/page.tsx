"use client"

import Link from "next/link"
import { useState } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { FilterChips } from "@/components/music/filter-chips"
import { LikedCover, useLibrary } from "@/components/layout/app-sidebar"
import { ArtistAvatar, Cover } from "@/components/music/cover"
import { hrefAlbum, hrefArtist, hrefPlaylist } from "@/components/music/media-card"
import { ErrorState } from "@/components/music/states"
import { TopBar } from "@/components/music/top-bar"
import { hrefPodcast, podcasts, usePodcastsEnabled } from "@/components/podcast/podcast-playback"
import { podcastCover, type PodcastFollows } from "@/lib/podcasts"
import { useData } from "@/lib/use-data"

type Filter = "all" | "playlists" | "podcasts" | "albums" | "artists"

function Row({ href, title, subtitle, art }: { href: string; title: string; subtitle: string; art: React.ReactNode }) {
  return (
    <Link href={href} className="flex min-h-16 items-center gap-3 rounded-lg px-2 py-1.5 outline-none transition-colors duration-150 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring active:bg-muted">
      {art}
      <div className="min-w-0">
        <div className="truncate text-[15px] font-medium">{title}</div>
        <div className="truncate text-[13px] text-muted-foreground">{subtitle}</div>
      </div>
    </Link>
  )
}

export default function LibraryPage() {
  const [filter, setFilter] = useState<Filter>("all")
  const { data, error, loading } = useLibrary()
  const show = (f: Filter) => filter === "all" || filter === f
  const podcastsEnabled = usePodcastsEnabled()
  const follows = useData<PodcastFollows>(podcastsEnabled ? "podcast-follows" : null, () => podcasts.getFollows())
  return (
    <div>
      <TopBar title="Tu biblioteca" />
      <div className="flex flex-col gap-3 px-2 pt-2 md:px-4">
        <h1 className="hidden px-2 text-3xl font-bold tracking-tight md:block">Tu biblioteca</h1>
        <FilterChips
          className="px-2"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "Todo" },
            { value: "playlists", label: "Playlists" },
            ...(podcastsEnabled ? [{ value: "podcasts" as const, label: "Podcasts" }] : []),
            { value: "albums", label: "Álbumes" },
            { value: "artists", label: "Artistas" },
          ]}
        />
        {error && <ErrorState error={error} />}
        <div className="flex flex-col">
          {show("playlists") && <Row href="/liked/" title="Tus me gusta" subtitle="Playlist" art={<LikedCover className="size-14" />} />}
          {loading &&
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-1.5">
                <Skeleton className="size-14 rounded-sm" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/5" />
                </div>
              </div>
            ))}
          {show("playlists") &&
            data?.playlists.map((p) => <Row key={p.id} href={hrefPlaylist(p.id)} title={p.name} subtitle={`Playlist · ${p.songCount} canciones`} art={<Cover coverArt={p.coverArt} alt={p.name} size={120} rounded="sm" className="size-14" />} />)}
          {show("podcasts") &&
            follows.data?.podcasts.map((p) => <Row key={p.id} href={hrefPodcast(p.id)} title={p.title} subtitle={`Podcast · ${p.author || "Episodios"}`} art={<Cover coverArt={podcastCover(p)} alt={p.title} size={120} rounded="sm" className="size-14" />} />)}
          {filter === "podcasts" && follows.data && !follows.data.podcasts.length && (
            <p className="px-2 py-6 text-sm text-muted-foreground">Aún no sigues ningún podcast. Búscalos en Buscar → Podcasts y pulsa «Seguir».</p>
          )}
          {filter === "podcasts" && follows.error && <ErrorState error={follows.error} />}
          {show("albums") &&
            data?.albums.map((a) => <Row key={a.id} href={hrefAlbum(a.id)} title={a.name} subtitle={`Álbum · ${a.artist}`} art={<Cover coverArt={a.coverArt} alt={a.name} size={120} rounded="sm" className="size-14" />} />)}
          {show("artists") &&
            data?.artists.map((a) => <Row key={a.id} href={hrefArtist(a.id)} title={a.name} subtitle="Artista" art={<ArtistAvatar coverArt={a.coverArt} name={a.name} size={120} className="size-14" />} />)}
        </div>
      </div>
    </div>
  )
}
