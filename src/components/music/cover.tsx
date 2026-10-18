"use client"

import { Music } from "lucide-react"
import { useState } from "react"
import { useProvider } from "@/lib/providers"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useAuthenticatedArtwork } from "@/hooks/use-authenticated-artwork"

/** Sized artwork URL for the slot plus the provider's original as a fallback (YouTube high-res frames may not exist). */
function useSizedArtwork(coverArt: string | undefined, size: number) {
  const provider = useProvider()
  const primary = provider.coverUrl(coverArt, size)
  const original = provider.coverUrl(coverArt)
  const backup = original !== primary ? original : undefined
  const [failed, setFailed] = useState<string[]>([])
  const candidate = primary && !failed.includes(primary) ? primary : backup && !failed.includes(backup) ? backup : undefined
  const src = useAuthenticatedArtwork(candidate, candidate === primary ? backup : undefined)
  return { src, fail: () => candidate && setFailed((list) => [...list, candidate]) }
}

export function Cover({ coverArt, alt, size = 300, className, rounded = "md" }: { coverArt?: string; alt: string; size?: number; className?: string; rounded?: "sm" | "md" | "lg" }) {
  const { src, fail } = useSizedArtwork(coverArt, size)
  const r = rounded === "sm" ? "rounded-sm" : rounded === "lg" ? "rounded-xl" : "rounded-md"
  return (
    <div className={cn("relative aspect-square shrink-0 overflow-hidden bg-muted", r, className)}>
      {src ? (
        <img src={src} alt={alt} loading="lazy" draggable={false} onError={fail} className="size-full object-cover" />
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
      {src && <AvatarImage src={src} alt={name} className="object-cover" onLoadingStatusChange={(status) => { if (status === "error") fail() }} />}
      <AvatarFallback className="text-2xl font-medium">{name.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  )
}
