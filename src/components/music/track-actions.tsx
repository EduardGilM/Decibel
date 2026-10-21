"use client"

import Link from "next/link"
import { useState, type MouseEvent } from "react"
import { createPortal } from "react-dom"
import { ArrowDownCircle, Check, Disc3, ListEnd, ListMinus, ListPlus, MoreHorizontal, User } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { Track } from "@/lib/types"
import { cn } from "@/lib/utils"
import { canDownload, download, offlineKey, removeDownloads, useOffline } from "@/lib/offline/downloads"
import { useOfflineScope } from "@/lib/offline/context"
import { useConnection } from "@/lib/offline/connection"
import { getProvider, useProvider } from "@/lib/providers"
import { usePlayer } from "@/stores/player"
import { hrefAlbum, hrefArtist } from "./media-card"
import { addToQueueWithFeedback, removeFromQueueWithFeedback, upcomingIndex } from "./swipe-to-queue"

/** The song menu, shared by the «…» button and the right click on a row. */
function TrackMenuItems({ track }: { track: Track }) {
  const provider = useProvider()
  const scope = useOfflineScope()
  const key = offlineKey(provider.kind, track.id, scope)
  const saved = useOffline((s) => !!s.items[key])
  const busy = useOffline((s) => !!s.pending[key])
  const offline = useConnection((s) => s.offline)
  const queued = usePlayer((s) => s.queue.some((t, i) => i !== s.index && t.id === track.id))
  return (
    <>
      <DropdownMenuItem
        onSelect={() => {
          usePlayer.getState().playNext(track)
          toast("Se reproducirá a continuación")
        }}
      >
        <ListPlus /> Reproducir a continuación
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => addToQueueWithFeedback(track)}>
        <ListEnd /> Añadir a la cola
      </DropdownMenuItem>
      {queued && (
        <DropdownMenuItem onSelect={() => { const i = upcomingIndex(track.id); if (i >= 0) removeFromQueueWithFeedback(i) }}>
          <ListMinus /> Quitar de la cola
        </DropdownMenuItem>
      )}
      {canDownload(provider.kind, track) && <>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy || (offline && !saved)} onSelect={() => {
          void (async () => {
            try {
              if (saved) { await removeDownloads([key]); toast("Descarga eliminada") }
              else {
                const result = await download([track], getProvider())
                if (result.failed.length) toast.error(result.failed[0])
                else toast("Descargada para escuchar sin conexión")
              }
            } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo descargar.") }
          })()
        }}>{saved ? <Check /> : <ArrowDownCircle />}{saved ? "Quitar descarga" : busy ? "Descargando…" : "Descargar"}</DropdownMenuItem>
      </>}
      {(track.albumId || track.artistId) && <DropdownMenuSeparator />}
      {track.albumId && (
        <DropdownMenuItem asChild>
          <Link href={hrefAlbum(track.albumId)}>
            <Disc3 /> Ir al álbum
          </Link>
        </DropdownMenuItem>
      )}
      {track.artistId && (
        <DropdownMenuItem asChild>
          <Link href={hrefArtist(track.artistId)}>
            <User /> Ir al artista
          </Link>
        </DropdownMenuItem>
      )}
    </>
  )
}

export function TrackActions({ track, className }: { track: Track; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Más opciones para ${track.title}`} className={cn("aria-expanded:bg-transparent aria-expanded:text-foreground", className)} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
        <TrackMenuItems track={track} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Right click on a song row (mouse only: a long press on touch keeps its own behaviour) opens the same menu
 * as «…», anchored at the pointer. Render `menu` once per list and call `onContextMenu(track)` from each row.
 */
export function useTrackContextMenu() {
  const [state, setState] = useState<{ track: Track; x: number; y: number; key: number } | null>(null)
  function onContextMenu(track: Track) {
    return (event: MouseEvent<HTMLElement>) => {
      const type = (event.nativeEvent as Partial<PointerEvent>).pointerType
      const mouse = type ? type === "mouse" : window.matchMedia("(hover: hover) and (pointer: fine)").matches
      if (!mouse || (event.target as Element).closest("input, textarea")) return
      event.preventDefault()
      let { clientX: x, clientY: y } = event
      if (!x && !y) { const r = event.currentTarget.getBoundingClientRect(); x = r.left + 48; y = r.top + r.height / 2 } // context-menu key
      setState({ track, x, y, key: Date.now() })
    }
  }
  const menu = state && typeof document !== "undefined" ? createPortal(
    <DropdownMenu key={state.key} open onOpenChange={(open) => { if (!open) setState(null) }}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none fixed size-0" style={{ left: state.x, top: state.y }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={2} className="w-56" onClick={(e) => e.stopPropagation()}>
        <TrackMenuItems track={state.track} />
      </DropdownMenuContent>
    </DropdownMenu>,
    document.body,
  ) : null
  return { onContextMenu, menu }
}
