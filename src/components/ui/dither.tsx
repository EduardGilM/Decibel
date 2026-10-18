import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"

/**
 * Dithering for dark, low-contrast gradients (cover glow, tinted headers). An 8-bit WebView only has a
 * handful of levels between near-black reds, so smooth fades show as steps (banding). A fine,
 * high-contrast grey noise tile in `overlay` at 6 % breaks those steps up: overlay is zero-mean (it does
 * not lift the blacks, measured +0.4 levels) and moves each pixel by ±1–3 levels, just enough to dither
 * and too little to read as grain. The SVG filter works in sRGB (linearRGB would bias the noise bright)
 * and is stretched ×8 around mid-grey; the 256px tile is drawn at 128 CSS px so it stays sharp at 2× DPR.
 */
const NOISE = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><filter id='n' x='0' y='0' color-interpolation-filters='sRGB'>" +
    "<feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/>" +
    "<feColorMatrix values='0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0 1'/>" +
    "<feComponentTransfer><feFuncR type='linear' slope='8' intercept='-3.5'/><feFuncG type='linear' slope='8' intercept='-3.5'/><feFuncB type='linear' slope='8' intercept='-3.5'/></feComponentTransfer>" +
    "</filter><rect width='256' height='256' filter='url(#n)'/></svg>",
)}")`

export function Dither({ className, opacity = 0.06, mask }: { className?: string; opacity?: number; mask?: string }) {
  const style: CSSProperties = { backgroundImage: NOISE, backgroundSize: "128px 128px", opacity, mixBlendMode: "overlay" }
  if (mask) { style.maskImage = mask; style.WebkitMaskImage = mask }
  return <div aria-hidden className={cn("pointer-events-none absolute inset-0", className)} style={style} />
}

/** Many-stop eased alpha ramp (zero slope at both ends) for masks: no visible kink where a fade ends. */
export function easedMask(direction = "to bottom", start = 1, from = 0, steps = 16) {
  const stops: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const alpha = start * 0.5 * (1 + Math.cos(Math.PI * Math.pow(t, 1.3)))
    stops.push(`rgb(0 0 0 / ${alpha.toFixed(3)}) ${(from + (100 - from) * t).toFixed(1)}%`)
  }
  return `linear-gradient(${direction}, ${stops.join(", ")})`
}
