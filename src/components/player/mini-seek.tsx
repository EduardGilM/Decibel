"use client"

import { useRef, useState } from "react"
import { formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { usePlayer } from "@/stores/player"

/**
 * Seekable progress line along the bottom edge of the mobile mini player.
 * Thin (3px) line, 28px touch zone; tap jumps, drag scrubs (pointer capture) and the audio is only
 * seeked on release, so the audio's own position updates never fight the finger.
 * Never opens the full-screen player (events stop here).
 */
export function MiniSeek({ className }: { className?: string }) {
  const position = usePlayer((s) => s.position)
  const duration = usePlayer((s) => s.duration)
  const [drag, setDrag] = useState<number | null>(null)
  const zone = useRef<HTMLDivElement>(null)
  const value = Math.min(drag ?? position, duration || 0)
  const pct = duration ? (value / duration) * 100 : 0

  const at = (clientX: number) => {
    const box = zone.current!.getBoundingClientRect()
    const inset = 12 // the visible line is inset like the bar's rounded corners
    return Math.max(0, Math.min(1, (clientX - box.left - inset) / (box.width - inset * 2))) * duration
  }

  return (
    <div
      ref={zone}
      role="slider"
      aria-label="Posición"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(value)}
      aria-valuetext={`${formatTime(value)} de ${formatTime(duration)}`}
      aria-disabled={!duration}
      tabIndex={0}
      data-vaul-no-drag=""
      data-dragging={drag !== null || undefined}
      className={cn("group/seek absolute inset-x-0 bottom-0 h-7 touch-none outline-none select-none", className)}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (!duration || event.button > 0) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setDrag(at(event.clientX))
      }}
      onPointerMove={(event) => { if (drag !== null) setDrag(at(event.clientX)) }}
      onPointerUp={(event) => {
        event.stopPropagation()
        if (drag === null) return
        usePlayer.getState().seek(at(event.clientX))
        setDrag(null)
      }}
      onPointerCancel={() => setDrag(null)}
      onLostPointerCapture={() => setDrag(null)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        const step = event.key === "ArrowRight" ? 5 : event.key === "ArrowLeft" ? -5 : 0
        if (!step || !duration) return
        event.preventDefault()
        usePlayer.getState().seek(Math.max(0, Math.min(duration, position + step)))
      }}
    >
      <div className="absolute inset-x-3 bottom-[3px] h-[3px] rounded-full bg-white/25 transition-[height] duration-150 group-data-dragging/seek:h-[5px] group-focus-visible/seek:h-[5px]">
        <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
        <div
          aria-hidden
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-white shadow-[0_1px_4px_rgb(0_0_0/0.45)] transition-transform duration-150 group-data-dragging/seek:scale-100"
          style={{ left: `${pct}%` }}
        />
      </div>
      {drag !== null && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-4 -translate-x-1/2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums"
          style={{ left: `clamp(28px, calc(12px + (100% - 24px) * ${pct / 100}), calc(100% - 28px))` }}
        >
          {formatTime(value)} / {formatTime(duration)}
        </span>
      )}
    </div>
  )
}
