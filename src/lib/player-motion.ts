interface ArtworkBounds { left: number; top: number; width: number; height: number }

/** FLIP frames for a fixed artwork copy placed at the full player's final bounds. */
export function coverExpansionFrames(from: ArtworkBounds, to: ArtworkBounds) {
  if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) return null
  const scaleX = from.width / to.width, scaleY = from.height / to.height
  return [
    { transform: `translate3d(${from.left - to.left}px, ${from.top - to.top}px, 0) scale(${scaleX}, ${scaleY})` },
    { transform: "translate3d(0, 0, 0) scale(1, 1)" },
  ]
}
