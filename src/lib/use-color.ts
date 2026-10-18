"use client"

import { useEffect, useState } from "react"
import { useAuthenticatedArtwork } from "@/hooks/use-authenticated-artwork"
import { sampleCoverColors, type CoverColorMode, type CoverColors } from "@/lib/cover-colors"

const cache = new Map<string, CoverColors>()

/** Average for translucent tints, dominant colour for artwork-driven accents. */
export function useCoverColor(url: string | undefined, fallback?: string, mode: CoverColorMode = "average") {
  const source = useAuthenticatedArtwork(url)
  const [sample, setSample] = useState<{ url: string; colors: CoverColors }>()
  useEffect(() => {
    if (fallback || !url || !source) return
    const hit = cache.get(url)
    if (hit) return setSample({ url, colors: hit })
    let alive = true
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      try {
        const c = document.createElement("canvas")
        c.width = c.height = 32
        const ctx = c.getContext("2d")
        if (!ctx) return
        ctx.drawImage(img, 0, 0, 32, 32)
        const colors = sampleCoverColors(ctx.getImageData(0, 0, 32, 32).data)
        if (!colors) return
        if (cache.size >= 128) cache.delete(cache.keys().next().value!)
        cache.set(url, colors)
        if (alive) setSample({ url, colors })
      } catch {
        /* tainted canvas (no CORS) → no tint */
      }
    }
    img.src = source
    return () => {
      alive = false
    }
  }, [url, source, fallback])
  return fallback ?? (url ? cache.get(url)?.[mode] ?? (sample?.url === url ? sample.colors[mode] : undefined) : undefined)
}

