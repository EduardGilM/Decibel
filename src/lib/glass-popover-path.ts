export type GlassSide = "top" | "right" | "bottom" | "left"

export interface GlassPathInput {
  /** Radix side of the popover relative to its trigger; the arrow sits on the opposite edge. */
  side: GlassSide
  /** Panel size (without the arrow). */
  width: number
  height: number
  /** Arrow centre along the edge, measured from the panel's left (top/bottom) or top (left/right). */
  at: number
  radius: number
  /** Smallest radius the two corners next to the arrow may shrink to so the tip can reach a trigger near the panel's end (default: radius, never shrink). */
  minCornerRadius?: number
  arrowWidth: number
  arrowHeight: number
}

export interface GlassPath {
  d: string
  /** Where the path's box sits relative to the panel: it grows by the arrow height on the arrow edge. */
  box: { left: number; top: number; width: number; height: number }
  /** Clamped arrow centre actually drawn. */
  at: number
}

const K = 0.5523 // cubic Bézier approximation of a quarter circle
const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * One closed outline for panel + arrow, so a single element can be clipped to it.
 * Built in a canonical frame (arrow on the top edge, pointing up) and mapped to the real side.
 */
export function glassPopoverPath({ side, width, height, at, radius, minCornerRadius, arrowWidth, arrowHeight }: GlassPathInput): GlassPath {
  const vertical = side === "top" || side === "bottom"
  const L = vertical ? width : height // edge carrying the arrow
  const D = vertical ? height : width // panel depth
  const A = arrowHeight
  const r = Math.max(0, Math.min(radius, L / 2, D / 2))
  const hw = arrowWidth / 2
  const m = Math.min(r, Math.max(0, minCornerRadius ?? r))
  const fits = L >= 2 * (r + hw)
  const x = fits ? Math.min(Math.max(at, m + hw), L - m - hw) : L / 2
  // corners beside the arrow give way (down to m) when the tip sits close to them, like iOS menus pinned to a screen edge
  const rl = fits ? Math.min(r, Math.max(m, x - hw)) : r
  const rr = fits ? Math.min(r, Math.max(m, L - x - hw)) : r

  const W = vertical ? width : width + A
  const H = vertical ? height + A : height
  const map = ([u, v]: [number, number]): [number, number] => {
    switch (side) {
      case "bottom": return [u, v] // panel below the trigger: arrow on top
      case "top": return [u, H - v]
      case "right": return [v, u]
      case "left": return [W - v, u]
    }
  }
  const P = (u: number, v: number) => map([u, v]).map(r2).join(" ")
  const top = A, bottom = A + D, kr = K * r
  const parts = [`M ${P(rl, top)}`]
  if (fits) {
    parts.push(
      `L ${P(x - hw, top)}`,
      `C ${P(x - hw + hw * 0.5, top)} ${P(x - 3.2, 0.9)} ${P(x, 0)}`,
      `C ${P(x + 3.2, 0.9)} ${P(x + hw - hw * 0.5, top)} ${P(x + hw, top)}`,
    )
  }
  parts.push(
    `L ${P(L - rr, top)}`,
    `C ${P(L - rr + K * rr, top)} ${P(L, top + rr - K * rr)} ${P(L, top + rr)}`,
    `L ${P(L, bottom - r)}`,
    `C ${P(L, bottom - r + kr)} ${P(L - r + kr, bottom)} ${P(L - r, bottom)}`,
    `L ${P(r, bottom)}`,
    `C ${P(r - kr, bottom)} ${P(0, bottom - r + kr)} ${P(0, bottom - r)}`,
    `L ${P(0, top + rl)}`,
    `C ${P(0, top + rl - K * rl)} ${P(rl - K * rl, top)} ${P(rl, top)}`,
    "Z",
  )
  const box = {
    left: side === "right" ? -A : 0,
    top: side === "bottom" ? -A : 0,
    width: W,
    height: H,
  }
  return { d: parts.join(" "), box, at: x }
}
