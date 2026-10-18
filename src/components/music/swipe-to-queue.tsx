"use client"

import { ListMinus, ListPlus } from "lucide-react"
import type { ReactNode } from "react"
import { toast } from "sonner"
import { useRowSwipe } from "@/hooks/use-swipe-to-queue"
import type { Track } from "@/lib/types"
import { cn } from "@/lib/utils"
import { usePlayer } from "@/stores/player"

/** Index of an upcoming copy of the track in the queue (the song playing now cannot be removed). */
export function upcomingIndex(id: string) {
  const { queue, index } = usePlayer.getState()
  for (let i = queue.length - 1; i >= 0; i--) if (i !== index && queue[i].id === id) return i
  return -1
}

export function addToQueueWithFeedback(track: Track) {
  const empty = !usePlayer.getState().queue.length
  usePlayer.getState().addToQueue(track) // with nothing queued this starts playing it
  toast(empty ? "Reproduciendo" : "Añadida a la cola", { description: track.title, duration: 1800 })
}

export function removeFromQueueWithFeedback(i: number) {
  const track = usePlayer.getState().queue[i]
  if (!track) return
  usePlayer.getState().removeAt(i)
  toast("Quitada de la cola", { description: track.title, duration: 1800 })
}

/**
 * Swipeable row: the background revealed under it shows what releasing will do (green + add to queue on the
 * left, grey-red + remove on the right); past ~35 % of the width it is armed (stronger colour + vibration).
 */
export function SwipeRow({ onRight, onLeft, children, className }: { onRight?: () => void; onLeft?: () => void; children: ReactNode; className?: string }) {
  const { handlers, offset, dragging, armed } = useRowSwipe({ onRight, onLeft })
  const right = offset > 0
  return (
    <div data-swipe-row className={cn("relative min-w-0 select-none overflow-hidden rounded-md", className)} style={{ touchAction: "pan-y pinch-zoom" }} {...handlers}>
      {offset !== 0 && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-0 flex items-center overflow-hidden rounded-md transition-colors duration-150",
            right ? "left-0 justify-start pl-4" : "right-0 justify-end pr-4",
            right ? (onRight ? (armed ? "bg-primary text-primary-foreground" : "bg-primary/35 text-foreground") : "bg-foreground/10 text-muted-foreground")
              : onLeft ? (armed ? "bg-red-500/85 text-white" : "bg-foreground/15 text-foreground") : "bg-foreground/10 text-muted-foreground",
          )}
          style={{ width: Math.abs(offset) }}
        >
          {right ? <ListPlus className={cn("size-5 shrink-0 transition-transform", armed && "scale-110")} /> : <ListMinus className={cn("size-5 shrink-0 transition-transform", armed && "scale-110")} />}
        </span>
      )}
      <div className={cn("relative transition-transform duration-200 ease-out motion-reduce:transition-none", dragging && "transition-none")} style={{ transform: `translateX(${offset}px)` }}>
        {children}
      </div>
    </div>
  )
}

/** Song rows outside the queue (album, playlist, search, recent): right adds to the queue; left removes it only if queued. */
export function SwipeToQueue({ track, children, className }: { track: Track; children: ReactNode; className?: string }) {
  const queued = usePlayer((s) => s.queue.some((t, i) => i !== s.index && t.id === track.id))
  return (
    <SwipeRow
      className={className}
      onRight={() => addToQueueWithFeedback(track)}
      onLeft={queued ? () => { const i = upcomingIndex(track.id); if (i >= 0) removeFromQueueWithFeedback(i) } : undefined}
    >
      {children}
    </SwipeRow>
  )
}
