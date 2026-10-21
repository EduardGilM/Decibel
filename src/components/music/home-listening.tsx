"use client"

import { useSyncExternalStore } from "react"
import { Play } from "lucide-react"
import { formatTime } from "@/lib/format"
import { useRecentScope } from "@/lib/profile/search-sync"
import type { Playlist } from "@/lib/types"
import { useBrowse } from "@/stores/browse"
import { usePlayer } from "@/stores/player"
import { Cover } from "./cover"
import { Shelf } from "./shelf"

const subscribe = () => () => {}

export function HomeListening({ playlists = [] }: { playlists?: Playlist[] }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false)
  const { scope } = useRecentScope()
  const history = useBrowse((s) => s.profiles[scope])
  if (!mounted || !history) return null
  const last = history.last
  const track = last?.queue[last.index]
  const playlist = playlists.find((p) => last?.sourceLabel === `playlist:${p.id}`)
  return (
    <>
      {last && track && (
        <section className="flex flex-col gap-3 px-4 md:px-6" aria-label="Seguir escuchando">
          <h2 className="text-xl font-semibold tracking-tight">Seguir escuchando</h2>
          <button type="button" className="flex w-full max-w-lg items-center gap-3 rounded-lg bg-secondary/60 p-3 text-left hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={`Reanudar ${playlist?.name ?? track.title} desde ${formatTime(last.position)}`}
            onClick={() => usePlayer.getState().playList(last.queue, last.index, last.sourceLabel, last)}>
            <Cover coverArt={track.coverArt} alt="" size={120} rounded="sm" className="size-14 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{track.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{playlist?.name ?? track.artist} · {formatTime(last.position)}</span>
            </span>
            <Play className="mr-1 size-5 shrink-0 fill-current" aria-hidden />
          </button>
        </section>
      )}
      {history.recent.length > 0 && (
        <Shelf title="Recientes">
          {history.recent.map((item) => (
            <button key={item.id} type="button" className="flex shrink-0 flex-col gap-2 rounded-xl p-2 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={`Reproducir ${item.title}`} onClick={() => usePlayer.getState().playList([item], 0, "recent")}>
              <Cover coverArt={item.coverArt} alt="" />
              <span className="w-full truncate text-sm font-medium">{item.title}</span>
              <span className="-mt-1 w-full truncate text-[13px] text-muted-foreground">{item.artist}</span>
            </button>
          ))}
        </Shelf>
      )}
    </>
  )
}
