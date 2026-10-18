"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, ListPlus, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverGlassContent, PopoverTrigger } from "@/components/ui/popover"
import { Cover } from "@/components/music/cover"
import { hrefPlaylist } from "@/components/music/media-card"
import { useProvider } from "@/lib/providers"
import { cn } from "@/lib/utils"
import { usePlayer } from "@/stores/player"
import { removeFromQueueWithFeedback, SwipeRow } from "@/components/music/swipe-to-queue"
import { useSession } from "@/stores/session"

function RowBody({ i, active }: { i: number; active: boolean }) {
  const t = usePlayer((s) => s.queue[i])
  if (!t) return null
  return (
    <>
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => usePlayer.getState().jumpTo(i)}>
        <Cover coverArt={t.coverArt} alt={t.album} size={80} rounded="sm" className="size-11" />
        <div className="min-w-0">
          <div className={cn("truncate text-sm font-medium", active && "text-primary")}>{t.title}</div>
          <div className="truncate text-[13px] text-muted-foreground">{t.artist}</div>
        </div>
      </button>
      {!active && (
        <Button variant="ghost" size="icon" className="size-10 shrink-0 text-muted-foreground md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100" aria-label={`Quitar ${t.title} de la cola`} onClick={() => usePlayer.getState().removeAt(i)}>
          <X />
        </Button>
      )}
    </>
  )
}

/** Upcoming row: drag by the grip (mouse or finger; the grip is touch-none so the list still scrolls elsewhere) or keyboard (Space + arrows).
 *  Elsewhere on the row the drawer still closes by dragging down when the list is scrolled to the top. */
function SortableRow({ id, i }: { id: string; i: number }) {
  const title = usePlayer((s) => s.queue[i]?.title ?? "")
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("group/row relative flex items-center gap-1 rounded-lg py-1.5 pr-2 pl-0.5 hover:bg-muted/60", isDragging && "z-10 bg-secondary shadow-lg shadow-black/40")}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Mover ${title}`}
        className="flex h-11 w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing md:opacity-0 md:group-hover/row:opacity-100 md:focus-visible:opacity-100"
        // The full-screen player is a vaul drawer that is dragged down from anywhere: the grip's gesture must
        // reorder only. data-vaul-no-drag makes vaul ignore it; stopping propagation keeps the pointerdown
        // from ever reaching the drawer (dnd-kit's own listener runs first).
        data-vaul-no-drag=""
        {...attributes}
        {...listeners}
        onPointerDown={(event) => { listeners?.onPointerDown?.(event); event.stopPropagation() }}
        onTouchStart={(event) => event.stopPropagation()}
      >
        <GripVertical className="size-4" />
      </button>
      {/* Swipe right→left removes it from the queue; rightwards does nothing (bounces), like Spotify. */}
      <SwipeRow className="min-w-0 flex-1" onLeft={() => removeFromQueueWithFeedback(i)}>
        <div className="flex w-full min-w-0 items-center gap-1"><RowBody i={i} active={false} /></div>
      </SwipeRow>
    </div>
  )
}

/** Stable ids for dnd-kit even when the same song is queued twice. */
function sortableIds(ids: string[]) {
  const seen = new Map<string, number>()
  return ids.map((id) => { const n = (seen.get(id) ?? 0) + 1; seen.set(id, n); return `${id}#${n}` })
}

function UpNext({ from }: { from: number }) {
  const queue = usePlayer((s) => s.queue)
  const ids = useMemo(() => sortableIds(queue.slice(from).map((t) => t.id)), [queue, from])
  const sensors = useSensors(
    // Grip only (touch-none), so no press delay is needed on touch; a small distance tells taps from drags.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const a = ids.indexOf(String(active.id)), b = ids.indexOf(String(over.id))
    if (a >= 0 && b >= 0) usePlayer.getState().moveQueueItem(from + a, from + b)
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis, restrictToParentElement]} onDragEnd={onDragEnd}
      autoScroll={{ threshold: { x: 0, y: 0.15 }, acceleration: 12 }}
      accessibility={{ screenReaderInstructions: { draggable: "Pulsa espacio para coger la canción, flechas para moverla y espacio otra vez para soltarla." } }}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col">
          {ids.map((id, k) => <SortableRow key={id} id={id} i={from + k} />)}
        </div>
      </SortableContext>
    </DndContext>
  )
}

/** "Guardar como lista": creates a playlist with the whole queue, in queue order. */
export function SaveQueueButton({ className }: { className?: string }) {
  const provider = useProvider()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const queue = usePlayer((s) => s.queue)
  if (!provider.createPlaylist || !provider.addToPlaylist || queue.length === 0) return null
  const save = async () => {
    if (!provider.createPlaylist || !provider.addToPlaylist || busy || !name.trim()) return
    setBusy(true)
    try {
      const songs = usePlayer.getState().queue
      const seen = new Set<string>()
      const unique = songs.filter((t) => !seen.has(t.id) && seen.add(t.id))
      const list = await provider.createPlaylist(name.trim(), unique[0])
      for (const song of unique.slice(1)) await provider.addToPlaylist(list.id, song)
      toast.success(`Cola guardada como «${list.name}» (${unique.length} canciones)`, { action: { label: "Abrir", onClick: () => router.push(hrefPlaylist(list.id)) } })
      setOpen(false)
      setName("")
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Popover open={open} onOpenChange={(v) => { if (!busy) { setOpen(v); if (v && !name) setName(`Cola del ${new Date().toLocaleDateString("es-ES", { day: "numeric", month: "long" })}`) } }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={cn("rounded-full text-muted-foreground hover:text-foreground", className)}><ListPlus /> Guardar como lista</Button>
      </PopoverTrigger>
      <PopoverGlassContent align="end" className="w-72">
        <form className="flex flex-col gap-3 p-3.5" onSubmit={(e) => { e.preventDefault(); void save() }}>
          <p className="text-sm font-semibold">Guardar cola como lista</p>
          <Input autoFocus aria-label="Nombre de la lista" value={name} maxLength={80} disabled={busy} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
          <p className="text-xs text-muted-foreground">{queue.length} canciones, en el orden de la cola.</p>
          <div className="flex justify-end"><Button type="submit" disabled={busy || !name.trim()} className="h-9 rounded-full px-4">{busy && <Loader2 className="animate-spin" />} Guardar</Button></div>
        </form>
      </PopoverGlassContent>
    </Popover>
  )
}

export function QueueList({ className, showCurrent = true, showSave = showCurrent, heading = true }: { className?: string; showCurrent?: boolean; showSave?: boolean; heading?: boolean }) {
  const queue = usePlayer((s) => s.queue)
  const index = usePlayer((s) => s.index)
  const loadingRecommendations = usePlayer((s) => s.loadingRecommendations)
  const recommendationError = usePlayer((s) => s.recommendationError)
  const isYouTube = useSession((s) => s.mode === "ytdlp")
  const showRecommendationStatus = isYouTube && (loadingRecommendations || !!recommendationError)
  const current = queue[index]

  if (!current) return <p className="px-4 py-8 text-center text-sm text-muted-foreground">La cola está vacía. Reproduce algo para empezar.</p>
  if (!showCurrent && index >= queue.length - 1 && !showRecommendationStatus) return null

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {showCurrent && <section className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2 pr-1">
          <h3 className="px-2 text-sm font-semibold">Sonando ahora</h3>
          {showSave && <SaveQueueButton />}
        </div>
        <div className="flex items-center gap-3 rounded-lg bg-muted/60 px-2 py-1.5"><RowBody i={index} active /></div>
      </section>}
      {index < queue.length - 1 && (
        <section className="flex flex-col gap-1">
          {heading && <h3 className="px-2 text-sm font-semibold">A continuación</h3>}
          <UpNext from={index + 1} />
        </section>
      )}
      {showRecommendationStatus && (
        <section className="flex flex-col gap-2 px-2">
          {loadingRecommendations && <p role="status" className="text-xs text-muted-foreground">Buscando la siguiente canción…</p>}
          {recommendationError && (
            <div role="alert" className="text-xs text-muted-foreground">
              <p>{recommendationError}</p>
              <Button variant="link" className="h-8 px-0 text-xs" onClick={() => void usePlayer.getState().next()}>Reintentar</Button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
