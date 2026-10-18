"use client"

import { useRef, useState } from "react"
import type { MouseEvent, PointerEvent } from "react"

/** Fraction of the row width that confirms the action on release. */
export const SWIPE_CONFIRM = 0.35
/** Movement before the axis is decided; vertical wins scrolling, horizontal is ours. */
const AXIS_LOCK = 10
/** Left screen edge reserved for the profile panel's opening swipe. */
export const EDGE_ZONE = 24
/** Travel allowed towards a disabled side: a short rubber band that bounces back. */
const RUBBER = 28

export type SwipeSide = "right" | "left"

const haptic = () => { try { navigator.vibrate?.(12) } catch { /* no vibration API */ } }

/**
 * Horizontal touch/pen swipe on a row: right (left→right) and left (right→left) actions, each optional.
 * Vertical scrolling and taps keep working (axis locked after ~10 px); a disabled side only rubber-bands.
 */
export function useRowSwipe({ onRight, onLeft }: { onRight?: () => void; onLeft?: () => void }) {
  const gesture = useRef<{ id: number; x: number; y: number; dx: number; width: number; armed: boolean; intent: "pending" | "horizontal" | "vertical" } | null>(null)
  const suppressClick = useRef(false)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [width, setWidth] = useState(1)

  function reset() {
    gesture.current = null
    setOffset(0)
    setDragging(false)
  }

  const clamp = (dx: number) => {
    if (dx > 0) return onRight ? dx : Math.min(RUBBER, dx / 3)
    return onLeft ? dx : Math.max(-RUBBER, dx / 3)
  }

  const handlers = {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      suppressClick.current = false
      if (!event.isPrimary) { reset(); return }
      if (event.pointerType === "mouse" || event.button !== 0) return
      if (event.clientX < EDGE_ZONE) return // the profile panel owns swipes from the screen edge
      const control = (event.target as Element).closest("input, textarea, select, [role=slider], [data-swipe-ignore], [data-vaul-no-drag]")
      if (control && control !== event.currentTarget) return
      const w = event.currentTarget.getBoundingClientRect().width || 1
      setWidth(w)
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, width: w, armed: false, intent: "pending" }
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = gesture.current
      if (!current || current.id !== event.pointerId) return
      const dx = event.clientX - current.x
      const dy = event.clientY - current.y
      if (current.intent === "pending") {
        if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return
        suppressClick.current = true
        current.intent = Math.abs(dx) > Math.abs(dy) * 1.25 ? "horizontal" : "vertical"
        if (current.intent === "horizontal") {
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
        }
      }
      if (current.intent !== "horizontal") return
      event.stopPropagation() // the full-screen player's drawer must not see this drag
      current.dx = dx
      const armed = (dx > 0 ? !!onRight : !!onLeft) && Math.abs(dx) >= current.width * SWIPE_CONFIRM
      if (armed !== current.armed) { current.armed = armed; if (armed) haptic() }
      setOffset(clamp(dx))
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const current = gesture.current
      if (!current || current.id !== event.pointerId) return
      const side: SwipeSide | null = current.intent === "horizontal" && current.armed ? (current.dx > 0 ? "right" : "left") : null
      reset()
      if (side === "right") onRight?.()
      if (side === "left") onLeft?.()
    },
    onPointerCancel: reset,
    onLostPointerCapture(event: PointerEvent<HTMLElement>) {
      // Taking capture from a cover/button also bubbles that child's lost-capture event.
      if (event.target === event.currentTarget) reset()
    },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (!suppressClick.current || event.detail === 0) return
      suppressClick.current = false
      event.preventDefault()
      event.stopPropagation()
    },
  }

  return { handlers, offset, dragging, armed: Math.abs(offset) >= width * SWIPE_CONFIRM && (offset > 0 ? !!onRight : !!onLeft) }
}
