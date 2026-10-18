"use client"

import { useEffect, useRef, useState } from "react"
import type { MouseEvent, PointerEvent } from "react"
import { haptic } from "@/lib/haptics"
import { miniSwipeDecision, miniSwipeOffset, springStep } from "@/lib/mini-swipe"

/** Movement before the axis is decided; vertical goes to the page, horizontal is ours. */
const AXIS_LOCK = 10
/** Left screen edge reserved for the profile panel's opening swipe. */
const EDGE_ZONE = 24

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

/**
 * Horizontal swipe on the mini player: the strip follows the finger, the neighbour song peeks in from the
 * side and the release settles with a spring. Left = next, right = previous; a side with nothing to play only
 * rubber-bands. Taps, the seek line (it stops its own events) and vertical scrolling keep working: the axis
 * is locked after ~10 px and a horizontal drag swallows the click that would open the player.
 */
export function useMiniSwipe({ hasNext, hasPrev, onNext, onPrev, distance }: {
  hasNext: boolean; hasPrev: boolean; onNext: () => void; onPrev: () => void
  /** How far the strip travels to centre the neighbour (defaults to the strip width). */
  distance?: (side: "next" | "prev") => number
}) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const width = useRef(1)
  const gesture = useRef<{ id: number; x: number; y: number; t: number; lastX: number; lastT: number; v: number; intent: "pending" | "horizontal" | "vertical" } | null>(null)
  const suppressClick = useRef(false)
  const frame = useRef(0)
  const live = useRef(0)

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const show = (x: number) => { live.current = x; setOffset(x) }

  /** Springs from the current offset to `target`, then runs `done`. */
  function settle(target: number, velocity: number, done?: () => void) {
    cancelAnimationFrame(frame.current)
    if (reducedMotion()) { show(target); done?.(); return }
    let x = live.current, v = velocity, last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000)
      last = now
      ;[x, v] = springStep(x, v, target, dt)
      const doneMoving = Math.abs(x - target) < 0.5 && Math.abs(v) < 20
      // A committed skip only has to reach the edge; it does not need to wobble there.
      const passed = target !== 0 && Math.sign(x - target) === Math.sign(target)
      if (doneMoving || passed) { show(target); done?.(); return }
      show(x)
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }

  const handlers = {
    // Capture phase: the artist links stop pointerdown from bubbling, but a swipe may start on them too.
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      suppressClick.current = false
      if (!event.isPrimary || event.pointerType === "mouse" || event.button !== 0) return
      if (event.clientX < EDGE_ZONE) return
      if ((event.target as Element).closest("[role=slider], input, [data-swipe-ignore]")) return
      cancelAnimationFrame(frame.current)
      width.current = event.currentTarget.getBoundingClientRect().width || 1
      const now = event.timeStamp
      gesture.current = { id: event.pointerId, x: event.clientX - live.current, y: event.clientY, t: now, lastX: event.clientX, lastT: now, v: 0, intent: "pending" }
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const g = gesture.current
      if (!g || g.id !== event.pointerId) return
      const dx = event.clientX - g.x
      const dy = event.clientY - g.y
      if (g.intent === "pending") {
        if (Math.abs(dx - live.current) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return
        suppressClick.current = true
        g.intent = Math.abs(dx - live.current) > Math.abs(dy) * 1.25 ? "horizontal" : "vertical"
        if (g.intent === "horizontal") {
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
        }
      }
      if (g.intent !== "horizontal") return
      event.stopPropagation()
      const dt = event.timeStamp - g.lastT
      if (dt > 0) g.v = 0.7 * ((event.clientX - g.lastX) / dt) + 0.3 * g.v
      g.lastX = event.clientX
      g.lastT = event.timeStamp
      show(miniSwipeOffset(dx, hasNext, hasPrev))
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const g = gesture.current
      if (!g || g.id !== event.pointerId) return
      gesture.current = null
      setDragging(false)
      if (g.intent !== "horizontal") { if (live.current) settle(0, 0); return }
      // A finger that stopped before lifting is not a flick.
      const velocity = event.timeStamp - g.lastT > 80 ? 0 : g.v
      const decision = miniSwipeDecision({ dx: event.clientX - g.x, velocity, width: width.current, hasNext, hasPrev })
      if (!decision) { settle(0, velocity * 1000); return }
      haptic()
      const travel = distance?.(decision) || width.current
      const target = decision === "next" ? -travel : travel
      settle(target, velocity * 1000, () => {
        if (decision === "next") onNext(); else onPrev()
        show(0) // the new song is now the centre item
      })
    },
    onPointerCancel() {
      gesture.current = null
      setDragging(false)
      settle(0, 0)
    },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (!suppressClick.current || event.detail === 0) return
      suppressClick.current = false
      event.preventDefault()
      event.stopPropagation()
    },
  }

  return { handlers, offset, dragging }
}
