"use client"

import Link from "next/link"
import { AudioLines, Clock3 } from "lucide-react"
import type { ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatTime } from "@/lib/format"
import type { Track } from "@/lib/types"
import { cn } from "@/lib/utils"
import { usePlayer } from "@/stores/player"
import { usePrepareTrack } from "@/hooks/use-prepare-track"
import { useSearch } from "@/stores/search"
import { recentScope } from "@/lib/profile/search-sync"
import { Cover } from "./cover"
import { TrackSaveButtons } from "./track-save-buttons"
import { hrefAlbum } from "./media-card"
import { TrackActions, useTrackContextMenu } from "./track-actions"
import { SwipeToQueue } from "./swipe-to-queue"
import { ArtistLinks } from "./artist-links"

/** `subline`: extra text after the artist (e.g. "añadida por"); `trailing`: per-row control before the menu. */
export function TrackList({ tracks, label, showCover = true, showAlbum = true, numbered = true, singleTrack = false, subline, trailing }: { tracks: Track[]; label: string; showCover?: boolean; showAlbum?: boolean; numbered?: boolean; singleTrack?: boolean; subline?: (track: Track, index: number) => ReactNode; trailing?: (track: Track, index: number) => ReactNode }) {
  const currentId = usePlayer((s) => s.queue[s.index]?.id)
  const isPlaying = usePlayer((s) => s.isPlaying)
  const sourceLabel = usePlayer((s) => s.sourceLabel)
  const { prepare, cancel } = usePrepareTrack(singleTrack ? tracks[0] : undefined)
  const contextMenu = useTrackContextMenu()
  function playTrack(track: Track, index: number) {
    if (label?.startsWith("search:")) {
      useSearch.getState().remember(recentScope().scope, track)
    }
    usePlayer.getState().playList(singleTrack ? [track] : tracks, singleTrack ? 0 : index, label)
  }

  return (
    <>
    {contextMenu.menu}
    <Table className="table-fixed">
      <TableHeader className="hidden md:table-header-group">
        <TableRow className="text-muted-foreground hover:bg-transparent">
          {numbered && <TableHead className="w-10 text-center">#</TableHead>}
          <TableHead>Título</TableHead>
          {showAlbum && <TableHead className="hidden lg:table-cell">Álbum</TableHead>}
          <TableHead className="w-20" />
          <TableHead className="w-16 text-right">
            <Clock3 className="ml-auto size-4" aria-label="Duración" />
          </TableHead>
          <TableHead className={trailing ? "w-20" : "w-12"} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {tracks.map((t, i) => {
          const active = t.id === currentId && (sourceLabel === label || !sourceLabel)
          return (
            <TableRow
              key={`${t.id}-${i}`}
              data-state={active ? "selected" : undefined}
              // No highlight while its «…» menu is open (TableRow's has-aria-expanded) — only the playing row stays marked.
              className={cn("cursor-pointer border-0 hover:bg-muted/60 has-aria-expanded:bg-transparent", active && "bg-muted hover:bg-muted has-aria-expanded:bg-muted")}
              onPointerEnter={() => prepare(t)}
              onPointerLeave={cancel}
              onPointerDown={() => prepare(t, true)}
              onFocus={() => prepare(t)}
              onContextMenu={contextMenu.onContextMenu(t)}
              onClick={() => {
                if (active) usePlayer.getState().toggle()
                else playTrack(t, i)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") playTrack(t, i)
              }}
              tabIndex={0}
            >
              {numbered && (
                <TableCell className="hidden w-10 text-center text-muted-foreground tabular-nums md:table-cell">
                  {active && isPlaying ? <AudioLines className="mx-auto size-4 text-primary" /> : <span className={cn(active && "text-primary")}>{t.track ?? i + 1}</span>}
                </TableCell>
              )}
              <TableCell className="py-1.5">
                <SwipeToQueue track={t}>
                  <div className="flex min-w-0 items-center gap-3">
                    {showCover && <Cover coverArt={t.coverArt} alt={t.album} size={80} rounded="sm" className="size-11 md:size-10" />}
                    <div className="min-w-0">
                      <div className={cn("truncate text-[15px] font-medium md:text-sm", active && "text-primary")}>{t.title}</div>
                      <div className="truncate text-[13px] text-muted-foreground">
                        <ArtistLinks track={t} />
                        {subline?.(t, i)}
                      </div>
                    </div>
                  </div>
                </SwipeToQueue>
              </TableCell>
              {showAlbum && (
                <TableCell className="hidden truncate text-muted-foreground lg:table-cell">
                  {t.albumId ? (
                    <Link href={hrefAlbum(t.albumId)} onClick={(e) => e.stopPropagation()} className="hover:text-foreground hover:underline">
                      {t.album}
                    </Link>
                  ) : (
                    t.album
                  )}
                </TableCell>
              )}
              <TableCell className="w-20 p-0">
                <TrackSaveButtons track={t} className="justify-center" buttonClassName="size-9" />
              </TableCell>
              <TableCell className="hidden w-16 text-right text-muted-foreground tabular-nums md:table-cell">{formatTime(t.duration)}</TableCell>
              <TableCell className={cn("p-0 text-right", trailing ? "w-20" : "w-12")}>
                {trailing?.(t, i)}
                <TrackActions track={t} className="size-11 md:size-8" />
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
    </>
  )
}

export function TrackListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 px-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-sm" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
          </div>
        </div>
      ))}
    </div>
  )
}
