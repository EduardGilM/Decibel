"use client"

import { Heart } from "lucide-react"
import { CollectionHeader, HeaderSkeleton } from "@/components/music/collection-header"
import { PlayButton } from "@/components/music/play-button"
import { EmptyState, ErrorState } from "@/components/music/states"
import { TopBar } from "@/components/music/top-bar"
import { TrackList, TrackListSkeleton } from "@/components/music/track-list"
import { LikedCover } from "@/components/layout/app-sidebar"
import { useData } from "@/lib/use-data"
import { useSession } from "@/stores/session"

export default function LikedPage() {
  const { data, error, loading } = useData("starred", (p) => p.getStarred())
  const user = useSession((s) => (s.mode === "subsonic" ? s.creds?.username : s.mode === "ytdlp" ? "YouTube" : "Demo"))
  const tracks = data?.tracks ?? []
  return (
    <div>
      <TopBar title="Tus me gusta" />
      {loading && (
        <>
          <HeaderSkeleton />
          <TrackListSkeleton />
        </>
      )}
      {error && <ErrorState error={error} />}
      {data && (
        <>
          <CollectionHeader kind="Playlist" title="Tus me gusta" color="#3b3b98" art={<LikedCover className="w-48 rounded-xl md:w-56" />} meta={<span><span className="font-semibold">{user}</span> · {tracks.length} canciones</span>}>
              <PlayButton tracks={tracks} label="liked" />
          </CollectionHeader>
          {tracks.length ? (
            <div className="px-2 md:px-4">
              <TrackList tracks={tracks} label="liked" numbered={false} />
            </div>
          ) : (
            <EmptyState icon={Heart} title="Las canciones que te gusten aparecerán aquí">
              Guarda canciones pulsando el icono del corazón.
            </EmptyState>
          )}
        </>
      )}
    </div>
  )
}
