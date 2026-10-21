"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { coverExpansionFrames } from "@/lib/player-motion"
import { usePlayer } from "@/stores/player"

/** A temporary artwork copy flies above the drawer; the real artwork keeps its layout and gestures. */
export function useCoverExpansion(trackId: string | undefined, fullOpen: boolean) {
  const miniCover = useRef<HTMLDivElement>(null)
  const destination = useRef<HTMLDivElement | null>(null)
  const pending = useRef<{
    source: HTMLElement; sourceVisibility: string; copy: HTMLElement; from: DOMRect
    target?: HTMLElement; visibility?: string; animation?: Animation; timer?: ReturnType<typeof setTimeout>; stopWaiting?: () => void
  } | null>(null)
  const frame = useRef(0)
  // Keep this flag for the entire opening: removing it at the end would restart Vaul's slide-in.
  const [sharedOpen, setSharedOpen] = useState(false)

  const clear = useCallback(() => {
    cancelAnimationFrame(frame.current)
    const current = pending.current
    pending.current = null
    if (!current) return
    clearTimeout(current.timer)
    current.stopWaiting?.()
    current.animation?.cancel()
    current.copy.remove()
    current.source.style.visibility = current.sourceVisibility
    if (current.target) current.target.style.visibility = current.visibility ?? ""
  }, [])

  useEffect(() => { clear() }, [trackId, clear])
  useEffect(() => {
    if (!fullOpen) { clear(); setSharedOpen(false) }
  }, [fullOpen, clear])
  useEffect(() => clear, [clear])
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const changed = () => { if (motion.matches) clear() }
    motion.addEventListener("change", changed)
    window.addEventListener("resize", clear)
    return () => { motion.removeEventListener("change", changed); window.removeEventListener("resize", clear) }
  }, [clear])

  const openPlayer = () => {
    if (usePlayer.getState().fullOpen) return
    clear()
    const source = miniCover.current
    const from = source?.getBoundingClientRect()
    const animate = source && from && from.width > 0 && from.height > 0 && typeof source.animate === "function" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    setSharedOpen(!!animate)
    if (animate) {
      const copy = source.cloneNode(true) as HTMLElement
      copy.setAttribute("aria-hidden", "true")
      copy.dataset.coverFlight = ""
      Object.assign(copy.style, {
        position: "fixed", left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
        maxWidth: "none", margin: "0", zIndex: "70", pointerEvents: "none", transformOrigin: "top left", willChange: "transform",
      })
      document.body.append(copy)
      pending.current = { source, sourceVisibility: source.style.visibility, copy, from }
      source.style.visibility = "hidden"
      // Defensive cleanup if the portal never mounts (navigation or an interrupted open).
      pending.current.timer = setTimeout(clear, 1000)
    }
    // Opening from the mini player always presents its matching full-size artwork.
    usePlayer.getState().setFullTab("now")
    usePlayer.getState().setFullOpen(true)
    // A quick reopen can reuse the portal that is still finishing its closing animation.
    if (destination.current) fullCover(destination.current)
  }

  const fullCover = useCallback((target: HTMLDivElement | null) => {
    destination.current = target
    if (!target) {
      // Ref callbacks can detach and reattach in one commit (including Strict Mode).
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(() => { if (!destination.current) clear() })
      return
    }
    const current = pending.current
    if (!current || current.animation) return
    // Hide the destination before its first paint, including when its image is already cached.
    if (current.target !== target) {
      if (current.target) current.target.style.visibility = current.visibility ?? ""
      current.target = target
      current.visibility = target.style.visibility
      target.style.visibility = "hidden"
    }
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      if (pending.current !== current || current.animation || !target.isConnected) return
      const to = target.getBoundingClientRect()
      const frames = coverExpansionFrames(current.from, to)
      if (!frames || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { clear(); return }
      clearTimeout(current.timer)
      // A fixed clip and transform-only keyframes let the compositor move the cover without repainting each frame.
      Object.assign(current.copy.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, borderRadius: getComputedStyle(target).borderRadius })
      current.animation = current.copy.animate(frames, { duration: 380, easing: "cubic-bezier(0.2, 0, 0.2, 1)", fill: "both" })
      const finish = () => { if (pending.current === current) clear() }
      const reveal = async () => {
        // Authenticated artwork has no <img> until its fetch completes. Wait for the cover's ready signal too.
        if (!target.hasAttribute("data-cover-ready")) {
          await new Promise<void>((resolve) => {
            const observer = new MutationObserver(() => { if (target.hasAttribute("data-cover-ready")) current.stopWaiting?.() })
            current.stopWaiting = () => { observer.disconnect(); clearTimeout(current.timer); resolve() }
            observer.observe(target, { attributes: true, attributeFilter: ["data-cover-ready"] })
            current.timer = setTimeout(current.stopWaiting, 2000)
          })
        }
        if (pending.current !== current) return
        // Keep the small copy at its final bounds until the full-size image has also finished fading in.
        const image = target.querySelector("img")
        if (image) {
          await Promise.all(image.getAnimations().map((animation) => animation.finished.catch(() => {})))
        }
        if (pending.current !== current) return
        target.style.visibility = current.visibility ?? ""
        current.animation = current.copy.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: "forwards" })
        void current.animation.finished.then(finish, finish)
      }
      void current.animation.finished.then(reveal, finish)
    })
  }, [clear])

  return { miniCover, fullCover, openPlayer, sharedOpen }
}
