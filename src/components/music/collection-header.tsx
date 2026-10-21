"use client"

import { Dither, easedMask } from "@/components/ui/dither"
import type { ReactNode } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { useProvider } from "@/lib/providers"
import { useCoverColor } from "@/lib/use-color"
import { cn } from "@/lib/utils"
import { ArtistAvatar, Cover } from "./cover"

/**
 * Keep the artwork colour across the cover, title and controls. The long smoothstep tail below
 * the header blends into the song list, with zero slope at both ends to avoid a visible edge.
 */
export const tintColor = (tint: string, strength = 42) => `color-mix(in oklab, ${tint} ${strength}%, transparent)`

export function tintFade(tint: string, strength = 42, from = 60) {
  const stops = [`${tintColor(tint, strength)} 0%`]
  for (let i = 0; i <= 12; i++) {
    const t = i / 12
    const keep = 1 - t * t * (3 - 2 * t)
    stops.push(`color-mix(in oklab, ${tint} ${Math.round(strength * keep * 10) / 10}%, transparent) ${Math.round((from + (100 - from) * t) * 10) / 10}%`)
  }
  return `linear-gradient(to bottom, ${stops.join(", ")})`
}

export function CollectionHeader({ kind, title, coverArt, color, round, meta, art, children, bleed = false }: { kind: string; art?: ReactNode; title: string; coverArt?: string; color?: string; round?: boolean; meta?: ReactNode; children?: ReactNode; bleed?: boolean }) {
  const provider = useProvider()
  const tint = useCoverColor(provider.coverUrl(coverArt, 64), color ?? provider.coverColor?.(coverArt))
  return (
    <div className="relative">
      {/* With a transparent top bar, main starts below the status bar; this strip carries the tint up to the edge. */}
      {bleed && tint && <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 h-[var(--safe-top)]" style={{ backgroundColor: tintColor(tint) }} />}
      {/* translucent tint taken from the artwork (explicit exception to flat Trace Style) */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-14 -bottom-60" style={tint ? { backgroundImage: tintFade(tint) } : undefined}>
        {tint && <Dither opacity={0.035} mask={easedMask("to bottom", 1, 60)} />}
      </div>
      <div className="relative flex flex-col items-center gap-4 px-4 pt-4 pb-5 sm:flex-row sm:items-end sm:gap-6 md:px-6 md:pb-6">
        {art ? (
          art
        ) : round ? (
          <ArtistAvatar coverArt={coverArt} name={title} size={500} className="w-44 md:w-56" />
        ) : (
          <Cover coverArt={coverArt} alt={title} size={500} rounded="lg" className="w-48 md:w-56" />
        )}
        <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto">
          <span className="hidden text-xs font-medium tracking-wide uppercase sm:block">{kind}</span>
          <h1 className={cn("font-bold tracking-tight break-words", title.length > 24 ? "text-3xl md:text-5xl" : "text-4xl md:text-6xl lg:text-7xl")}>{title}</h1>
          {meta && <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-foreground/80">{meta}</div>}
        </div>
      </div>
      {children && <div className="relative flex items-center gap-2 px-4 pb-4 md:px-6">{children}</div>}
    </div>
  )
}

export function HeaderSkeleton() {
  return (
    <div role="status" aria-label="Cargando colección" className="flex flex-col items-center gap-4 p-4 sm:flex-row sm:items-end md:p-6">
      <Skeleton className="aspect-square w-48 rounded-xl md:w-56" />
      <div className="flex w-full flex-col gap-3">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    </div>
  )
}
