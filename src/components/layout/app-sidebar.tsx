"use client"

import { Heart } from "lucide-react"
import { useData } from "@/lib/use-data"
import { cn } from "@/lib/utils"

/** Library contents shared by the desktop rail, the library page and Home. */
export function useLibrary() {
  return useData("library", async (p) => {
    const [playlists, albums, artists] = await Promise.all([p.getPlaylists(), p.getAlbums("alphabeticalByName"), p.getArtists()])
    return { playlists, albums, artists }
  })
}

export function LikedCover({ className }: { className?: string }) {
  return (
    <div className={cn("flex aspect-square shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground", className)}>
      <Heart className="size-1/2 fill-current" />
    </div>
  )
}
