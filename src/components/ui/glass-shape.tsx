"use client"

import * as React from "react"
import { glassPopoverPath, type GlassSide } from "@/lib/glass-popover-path"
import styles from "./popover.module.css"

/** Arrow size (base × height) and corner radius of the glass surfaces, in px. */
export const GLASS_ARROW = { width: 24, height: 11 } as const
export const GLASS_RADIUS = 14
/** Menus may pull the arrow this close to a corner (its radius shrinks) to keep pointing at a small trigger near a screen edge. */
export const GLASS_MENU_CORNER = 6

export interface GlassGeometry { side: GlassSide; width: number; height: number; at: number }

/**
 * Tracks where Radix put the (hidden) arrow of a popper content, every frame while it is open,
 * so the drawn tip keeps pointing at the trigger after collisions (flip to top/bottom, shift along an edge).
 */
export function useGlassGeometry(content: React.RefObject<HTMLElement | null>, arrow: React.RefObject<SVGSVGElement | null>) {
  const [geo, setGeo] = React.useState<GlassGeometry>()
  React.useLayoutEffect(() => {
    let frame = 0
    const measure = () => {
      const el = content.current, tip = arrow.current
      if (el && tip) {
        const box = el.getBoundingClientRect(), mark = tip.getBoundingClientRect()
        const side = (el.dataset.side as GlassSide | undefined) ?? "bottom"
        const scale = box.width ? el.offsetWidth / box.width : 1 // undo the entry scale animation
        const vertical = side === "top" || side === "bottom"
        const at = vertical ? (mark.left + mark.width / 2 - box.left) * scale : (mark.top + mark.height / 2 - box.top) * scale
        const next = { side, width: el.offsetWidth, height: el.offsetHeight, at: Math.round(at * 2) / 2 }
        setGeo((prev) => (prev && prev.side === next.side && prev.width === next.width && prev.height === next.height && prev.at === next.at ? prev : next))
      }
      frame = requestAnimationFrame(measure)
    }
    measure()
    return () => cancelAnimationFrame(frame)
  }, [content, arrow])
  return geo
}

/**
 * Apple-style glass: the panel and its arrow are ONE element clipped to one SVG path (single backdrop-filter,
 * no seam); an SVG frame draws the hairline border and a soft shadow outside that path.
 * Render it as the first child of a `styles.glass` popper content, with the children wrapped in `styles.body`.
 */
export function GlassShape({ geo, minCornerRadius }: { geo?: GlassGeometry; minCornerRadius?: number }) {
  const maskId = React.useId().replace(/:/g, "")
  const shape = geo && glassPopoverPath({ ...geo, radius: GLASS_RADIUS, minCornerRadius, arrowWidth: GLASS_ARROW.width, arrowHeight: GLASS_ARROW.height })
  if (!shape) return null
  return (
    <>
      <div aria-hidden className={styles.surface} style={{ ...shape.box, clipPath: `path("${shape.d}")` }} />
      <svg aria-hidden className={styles.frame} style={shape.box} width={shape.box.width} height={shape.box.height}>
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse" x={-60} y={-60} width={shape.box.width + 120} height={shape.box.height + 120}>
            <rect x={-60} y={-60} width={shape.box.width + 120} height={shape.box.height + 120} fill="white" />
            <path d={shape.d} fill="black" />
          </mask>
          <filter id={`${maskId}-blur`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12" /></filter>
        </defs>
        {/* soft shadow, kept outside the shape so the glass is not darkened */}
        <g mask={`url(#${maskId})`}>
          <path d={shape.d} transform="translate(0 8)" fill="black" fillOpacity={0.38} filter={`url(#${maskId}-blur)`} />
          <path d={shape.d} transform="translate(0 1)" fill="black" fillOpacity={0.18} />
        </g>
        <path d={shape.d} fill="none" stroke="white" strokeOpacity={0.13} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
    </>
  )
}

export const glassClasses = { glass: styles.glass, menu: styles.menu, body: styles.body, player: styles.player } as const
