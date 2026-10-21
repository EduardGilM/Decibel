"use client"

import { Music } from "lucide-react"
import { useEffect, useState, type Ref } from "react"
import { useOffline } from "@/lib/offline/downloads"
import { useProvider } from "@/lib/providers"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useAuthenticatedArtwork } from "@/hooks/use-authenticated-artwork"
import { useConnection } from "@/lib/offline/connection"

/** Sized artwork URL for the slot plus the provider's original as a fallback (YouTube high-res frames may not exist). */
function useSizedArtwork(coverArt: string | undefined, size: number) {
  useOffline((s) => s.artworkRevision)
  const provider = useProvider()
  const primary = provider.coverUrl(coverArt, size)
  const original = provider.coverUrl(coverArt)
  const backup = original !== primary ? original : undefined
  const [failed, setFailed] = useState<string[]>([])
  const offline = useConnection((s) => s.offline)
  useEffect(() => { if (!offline) setFailed((list) => list.length ? [] : list) }, [offline])
  const candidate = primary && !failed.includes(primary) ? primary : backup && !failed.includes(backup) ? backup : undefined
  const src = useAuthenticatedArtwork(candidate, candidate === primary ? backup : undefined)
  return { src, loading: !!candidate && !src, fail: () => candidate && setFailed((list) => [...list, candidate]) }
}

export function Cover({ coverArt, alt, size = 300, className, rounded = "md", ref }: { coverArt?: string; alt: string; size?: number; className?: string; rounded?: "sm" | "md" | "lg"; ref?: Ref<HTMLDivElement> }) {
  const { src, loading, fail } = useSizedArtwork(coverArt, size)
  const [loadedSrc, setLoadedSrc] = useState<string>()
  const r = rounded === "sm" ? "rounded-sm" : rounded === "lg" ? "rounded-xl" : "rounded-md"
  return (
    <div ref={ref} data-cover-ready={!loading && (!src || loadedSrc === src) || undefined} className={cn("relative aspect-square shrink-0 overflow-hidden bg-muted", r, className)}>
      {src ? (
        <img
          key={src}
          src={src}
          alt={alt}
          loading="lazy"
          draggable={false}
          onError={fail}
          onLoad={() => setLoadedSrc(src)}
          className={cn("size-full object-cover transition-opacity duration-300 motion-reduce:transition-none", loadedSrc === src ? "opacity-100" : "opacity-0")}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <Music className="size-1/3" />
        </div>
      )}
    </div>
  )
}

export function ArtistAvatar({ coverArt, name, size = 300, className }: { coverArt?: string; name: string; size?: number; className?: string }) {
  const { src, fail } = useSizedArtwork(coverArt, size)
  return (
    <Avatar className={cn("aspect-square size-auto", className)}>
      {src && <AvatarImage key={src} src={src} alt={name} onLoadingStatusChange={(status) => { if (status === "error") fail() }} />}
      <AvatarFallback className="text-2xl font-medium">{name.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  )
}
