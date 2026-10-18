"use client"

import { useEffect, useState } from "react"
import { useAuthenticatedArtwork } from "@/hooks/use-authenticated-artwork"

const cache = new Map<string, string>()

/** Average colour of a cover, used for the subtle translucent tint. */
export function useCoverColor(url: string | undefined, fallback?: string) {
  const source = useAuthenticatedArtwork(url)
  const [sample, setSample] = useState<{ url: string; color: string }>()
  useEffect(() => {
    if (fallback || !url || !source) return
    const hit = cache.get(url)
    if (hit) return setSample({ url, color: hit })
    let alive = true
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      try {
        const c = document.createElement("canvas")
        c.width = c.height = 12
        const ctx = c.getContext("2d")
        if (!ctx) return
        ctx.drawImage(img, 0, 0, 12, 12)
        const d = ctx.getImageData(0, 0, 12, 12).data
        let r = 0, g = 0, b = 0
        for (let i = 0; i < d.length; i += 4) {
          r += d[i]
          g += d[i + 1]
          b += d[i + 2]
        }
        const n = d.length / 4
        const hex = `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`
        cache.set(url, hex)
        if (alive) setSample({ url, color: hex })
      } catch {
        /* tainted canvas (no CORS) → no tint */
      }
    }
    img.src = source
    return () => {
      alive = false
    }
  }, [url, source, fallback])
  return fallback ?? (url ? cache.get(url) ?? (sample?.url === url ? sample.color : undefined) : undefined)
}

