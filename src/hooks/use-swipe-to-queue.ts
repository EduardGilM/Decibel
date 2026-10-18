"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { DragEvent, MouseEvent, PointerEvent } from "react"
import { haptic } from "@/lib/haptics"

/** Fraction of the row width that confirms the action on release. */
export const SWIPE_CONFIRM = 0.35
/** Movement before the axis is decided; vertical wins scrolling, horizontal is ours. */
const AXIS_LOCK = 10
/** Mouse drags need a little more travel before they become a swipe, so sloppy clicks stay clicks. */
const MOUSE_AXIS_LOCK = 14
/** Left screen edge reserved for the profile panel's opening swipe. */
export const EDGE_ZONE = 24
/** Travel allowed towards a disabled side: a short rubber band that bounces back. */
const RUBBER = 28
/** Touchpad: a two-finger horizontal swipe ends when no wheel event arrives for this long (inertia included). */
const WHEEL_IDLE = 160
/** Touchpad: the swipe stops following the fingers a bit past the confirm point. */
const WHEEL_MAX = 0.6

export type SwipeSide = "right" | "left"

type Gesture = { id: number; x: number; y: number; dx: number; width: number; armed: boolean; mouse: boolean; intent: "pending" | "horizontal" | "vertical" }
type WheelGesture = { dx: number; width: number; armed: boolean; intent: "horizontal" | "vertical"; timer: ReturnType<typeof setTimeout> | null }

/** Last time a vertical scroll went over any row: a page scroll that drifts sideways must not start a swipe. */
let lastVerticalWheel = 0

/** Elements inside a row that keep their own pointer gestures. */
const IGNORE = "input, textarea, select, [role=slider], [data-swipe-ignore], [data-vaul-no-drag]"

/**
 * Horizontal swipe on a row: right (left→right) and left (right→left) actions, each optional.
 * - Touch/pen: vertical scrolling and taps keep working (axis locked after ~10 px).
 * - Mouse: press and drag sideways (axis locked after ~14 px); a click, double click or a vertical move is untouched.
 * - Touchpad: two-finger horizontal scroll over the row (accumulated deltaX); releases when the wheel goes idle.
 * A disabled side only rubber-bands.
 */
export function useRowSwipe({ onRight, onLeft }: { onRight?: () => void; onLeft?: () => void }) {
  const gesture = useRef<Gesture | null>(null)
  const wheel = useRef<WheelGesture | null>(null)
  const suppressClick = useRef(false)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [width, setWidth] = useState(1)
  // Latest callbacks for the native wheel listener (attached once per element).
  const actions = useRef({ onRight, onLeft })
  useEffect(() => { actions.current = { onRight, onLeft } }, [onRight, onLeft])

  function reset() {
    gesture.current = null
    setOffset(0)
    setDragging(false)
  }

  const clamp = useCallback((dx: number) => {
    const { onRight: r, onLeft: l } = actions.current
    if (dx > 0) return r ? dx : Math.min(RUBBER, dx / 3)
    return l ? dx : Math.max(-RUBBER, dx / 3)
  }, [])

  const isArmed = useCallback((dx: number, w: number) => (dx > 0 ? !!actions.current.onRight : !!actions.current.onLeft) && Math.abs(dx) >= w * SWIPE_CONFIRM, [])

  // Touchpad (and horizontal mouse wheels): a native, non-passive listener so the browser's own horizontal
  // scroll / back-forward swipe does not also run while the row follows the fingers.
  const nodeRef = useRef<HTMLElement | null>(null)
  const onWheel = useCallback((event: WheelEvent) => {
    const node = nodeRef.current
    if (!node || event.ctrlKey || event.shiftKey) return // pinch-zoom and Shift+wheel stay native
    let current = wheel.current
    if (!current) {
      if (Math.abs(event.deltaX) < 1 && Math.abs(event.deltaY) < 1) return
      const w = node.getBoundingClientRect().width || 1
      const scrolling = event.timeStamp - lastVerticalWheel < WHEEL_IDLE
      const horizontal = !scrolling && Math.abs(event.deltaX) > Math.abs(event.deltaY) * 1.5
      current = wheel.current = { dx: 0, width: w, armed: false, intent: horizontal ? "horizontal" : "vertical", timer: null }
      if (current.intent === "horizontal") { setWidth(w); setDragging(true) }
    }
    if (current.intent === "vertical") lastVerticalWheel = event.timeStamp
    if (current.timer) clearTimeout(current.timer)
    current.timer = setTimeout(() => {
      const done = wheel.current
      wheel.current = null
      if (!done || done.intent !== "horizontal") return
      const side: SwipeSide | null = done.armed ? (done.dx > 0 ? "right" : "left") : null
      setOffset(0)
      setDragging(false)
      if (side === "right") actions.current.onRight?.()
      if (side === "left") actions.current.onLeft?.()
    }, WHEEL_IDLE)
    if (current.intent !== "horizontal") return
    event.preventDefault()
    // Fingers moving right scroll content left (negative deltaX): that is a rightwards swipe of the row.
    const step = event.deltaMode === 1 ? event.deltaX * 16 : event.deltaX
    const limit = current.width * WHEEL_MAX
    current.dx = Math.max(-limit, Math.min(limit, current.dx - step))
    const armed = isArmed(current.dx, current.width)
    if (armed !== current.armed) { current.armed = armed; if (armed) haptic() }
    setOffset(clamp(current.dx))
  }, [clamp, isArmed])

  const ref = useCallback((node: HTMLElement | null) => {
    nodeRef.current?.removeEventListener("wheel", onWheel)
    nodeRef.current = node
    node?.addEventListener("wheel", onWheel, { passive: false })
  }, [onWheel])

  useEffect(() => () => { if (wheel.current?.timer) clearTimeout(wheel.current.timer) }, [])

  const handlers = {
    // Capture phase: the artist links stop pointerdown from bubbling, but a swipe may start on them too.
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      suppressClick.current = false
      if (!event.isPrimary) { reset(); return }
      if (event.button !== 0) return
      const mouse = event.pointerType === "mouse"
      if (!mouse && event.clientX < EDGE_ZONE) return // the profile panel owns swipes from the screen edge
      const control = (event.target as Element).closest(IGNORE)
      if (control && control !== event.currentTarget) return
      const w = event.currentTarget.getBoundingClientRect().width || 1
      setWidth(w)
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, width: w, armed: false, mouse, intent: "pending" }
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = gesture.current
      if (!current || current.id !== event.pointerId) return
      if (current.mouse && !(event.buttons & 1)) { reset(); return } // released outside the window
      const dx = event.clientX - current.x
      const dy = event.clientY - current.y
      if (current.intent === "pending") {
        const lock = current.mouse ? MOUSE_AXIS_LOCK : AXIS_LOCK
        if (Math.abs(dx) < lock && Math.abs(dy) < lock) return
        current.intent = Math.abs(dx) > Math.abs(dy) * 1.25 ? "horizontal" : "vertical"
        // A vertical mouse move is not ours at all: the click (and text selection elsewhere) stay native.
        if (current.intent === "vertical" && current.mouse) { gesture.current = null; return }
        suppressClick.current = true
        if (current.intent === "horizontal") {
          event.currentTarget.setPointerCapture(event.pointerId)
          window.getSelection()?.removeAllRanges()
          setDragging(true)
        }
      }
      if (current.intent !== "horizontal") return
      event.stopPropagation() // the full-screen player's drawer must not see this drag
      current.dx = dx
      const armed = isArmed(dx, current.width)
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
    // Links and covers inside the row would otherwise start a native drag-and-drop with the mouse.
    onDragStart(event: DragEvent<HTMLElement>) {
      event.preventDefault()
    },
  }

  return { ref, handlers, offset, dragging, armed: Math.abs(offset) >= width * SWIPE_CONFIRM && (offset > 0 ? !!onRight : !!onLeft) }
}
