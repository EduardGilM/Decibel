"use client"

import { Dither, easedMask } from "@/components/ui/dither"
import { useProvider } from "@/lib/providers"
import { cn } from "@/lib/utils"
import { useAuthenticatedArtwork } from "@/hooks/use-authenticated-artwork"

/**
 * Soft backdrop made from the artwork itself: a tiny cover, heavily blurred and darkened,
 * fading into the page colour. Static image + CSS filter: the browser rasterises it once,
 * nothing is re-blurred per frame. Kept dim on purpose (low colour).
 */
// 16 eased stops instead of 3 linear ones: no kinks for the eye to read as bands.
const GLOW_MASK = easedMask()

export function CoverGlow({ coverArt, className, height = "70%" }: { coverArt?: string; className?: string; height?: string }) {
  const provider = useProvider()
  const src = useAuthenticatedArtwork(provider.coverUrl(coverArt, 64))
  if (!src) return null
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-0 overflow-hidden", className)} style={{ height, maskImage: GLOW_MASK, WebkitMaskImage: GLOW_MASK }}>
      <img key={src} src={src} alt="" draggable={false} className="absolute -inset-[25%] size-[150%] max-w-none object-cover opacity-70 blur-[64px] brightness-[0.6] saturate-[1.15] transition-opacity duration-500" />
      {/* breaks up the 8-bit steps of the dark blurred colour (banding on the phone) */}
      <Dither />
    </div>
  )
}
