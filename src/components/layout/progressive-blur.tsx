import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"

/**
 * Progressive blur: stacked backdrop-filter layers with increasing blur, each masked so the
 * effect ramps from fully transparent at the open edge to full strength at the anchored edge,
 * plus a background gradient. No borders, no hard edge. Purely decorative (pointer-events: none).
 *
 * direction="up"   → anchored at the bottom (bottom nav), fades out upwards.
 * direction="down" → anchored at the top (sticky headers), fades out downwards.
 */
const LAYERS: { blur: number; from: number; to: number }[] = [
  { blur: 2, from: 0, to: 30 },
  { blur: 6, from: 15, to: 50 },
  { blur: 12, from: 35, to: 70 },
  { blur: 24, from: 55, to: 90 },
]

export function ProgressiveBlur({ direction, fade = 48, tint = "var(--background)", strength = 88, saturation = 140, className }: { direction: "up" | "down"; fade?: number; tint?: string; strength?: number; saturation?: number; className?: string }) {
  // gradient starts at the anchored (solid) edge
  const towards = direction === "up" ? "to top" : "to bottom"
  const mask = ({ from, to }: { from: number; to: number }) => `linear-gradient(${towards}, black ${100 - to}%, transparent ${100 - from}%)`
  const layer = (l: (typeof LAYERS)[number]): CSSProperties => ({
    backdropFilter: `blur(${l.blur}px) saturate(${saturation}%)`,
    WebkitBackdropFilter: `blur(${l.blur}px) saturate(${saturation}%)`,
    maskImage: mask(l),
    WebkitMaskImage: mask(l),
  })
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-x-0 -z-10", className)}
      style={direction === "up" ? { top: -fade, bottom: 0 } : { top: 0, bottom: -fade }}
    >
      {LAYERS.map((l) => (
        <div key={l.blur} className="absolute inset-0" style={layer(l)} />
      ))}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(${towards}, color-mix(in oklab, ${tint} ${strength}%, transparent) 0%, color-mix(in oklab, ${tint} ${Math.round(strength * 0.8)}%, transparent) 45%, transparent 100%)`,
        }}
      />
    </div>
  )
}
