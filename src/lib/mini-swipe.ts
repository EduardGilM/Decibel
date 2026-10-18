import type { Track } from "./types.ts"

/** Fraction of the strip width that commits a skip on release. */
export const MINI_SWIPE_COMMIT = 0.33
/** Release speed (px/ms) that commits a skip even before the threshold (a quick flick). */
export const MINI_SWIPE_FLICK = 0.45
/** Minimum travel for a flick, so a jittery tap never skips. */
export const MINI_SWIPE_FLICK_MIN = 24
/** Travel allowed towards a side with nothing to play: a short rubber band. */
export const MINI_SWIPE_RUBBER = 36

export type MiniNeighbor = { track: Track; restart?: boolean } | { radio: true } | null

interface QueueView {
  queue: Track[]
  index: number
  repeat: "off" | "all" | "one"
  position: number
  hasRecommendations: boolean
}

/**
 * What a swipe would play, mirroring the store's `next()` / `prev()` (the same ones the buttons call):
 * - next: following song, wrap-around with «repeat all», or YouTube radio when the queue ends on a yt: song.
 * - prev: past 3 s it restarts the current song; otherwise the previous song (wrapping with «repeat all»).
 * `null` means there is nothing: the gesture only bounces.
 */
export function miniNeighbors({ queue, index, repeat, position, hasRecommendations }: QueueView): { next: MiniNeighbor; prev: MiniNeighbor } {
  const current = queue[index]
  if (!current) return { next: null, prev: null }
  let next: MiniNeighbor = null
  if (index < queue.length - 1) next = { track: queue[index + 1] }
  else if (repeat === "all" && queue.length > 1) next = { track: queue[0] }
  else if (repeat === "off" && hasRecommendations && current.id.startsWith("yt:")) next = { radio: true }
  let prev: MiniNeighbor = null
  if (position > 3) prev = { track: current, restart: true }
  else if (index > 0) prev = { track: queue[index - 1] }
  else if (repeat === "all" && queue.length > 1) prev = { track: queue[queue.length - 1] }
  return { next, prev }
}

/** Decides a released horizontal drag: dx < 0 (to the left) is «next», dx > 0 «previous». */
export function miniSwipeDecision({ dx, velocity, width, hasNext, hasPrev }: { dx: number; velocity: number; width: number; hasNext: boolean; hasPrev: boolean }): "next" | "prev" | null {
  const far = Math.abs(dx) >= width * MINI_SWIPE_COMMIT
  const flick = Math.abs(velocity) >= MINI_SWIPE_FLICK && Math.abs(dx) >= MINI_SWIPE_FLICK_MIN && Math.sign(velocity) === Math.sign(dx)
  if (!far && !flick) return null
  if (dx < 0) return hasNext ? "next" : null
  if (dx > 0) return hasPrev ? "prev" : null
  return null
}

/** Finger offset → strip offset: free towards a playable side, rubber band (1/3, capped) towards an empty one. */
export function miniSwipeOffset(dx: number, hasNext: boolean, hasPrev: boolean): number {
  if (dx < 0) return hasNext ? dx : Math.max(-MINI_SWIPE_RUBBER, dx / 3)
  return hasPrev ? dx : Math.min(MINI_SWIPE_RUBBER, dx / 3)
}

/** One step of a critically-damped-ish spring (semi-implicit Euler); returns [position, velocity] in px, px/s. */
export function springStep(x: number, v: number, target: number, dt: number, stiffness = 420, damping = 38): [number, number] {
  const a = -stiffness * (x - target) - damping * v
  const nv = v + a * dt
  return [x + nv * dt, nv]
}
