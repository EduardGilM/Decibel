"use client"

import Link from "next/link"
import { Disc3, ListEnd, ListPlus, MoreHorizontal, User } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { Track } from "@/lib/types"
import { cn } from "@/lib/utils"
import { usePlayer } from "@/stores/player"
import { hrefAlbum, hrefArtist } from "./media-card"

export function TrackActions({ track, className }: { track: Track; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Más opciones para ${track.title}`} className={cn("aria-expanded:bg-transparent aria-expanded:text-foreground", className)} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem
          onSelect={() => {
            usePlayer.getState().playNext(track)
            toast("Se reproducirá a continuación")
          }}
        >
          <ListPlus /> Reproducir a continuación
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            usePlayer.getState().addToQueue(track)
            toast("Añadida a la cola")
          }}
        >
          <ListEnd /> Añadir a la cola
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
