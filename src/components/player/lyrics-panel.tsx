"use client"

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react"
import { Loader2, Maximize2, Mic } from "lucide-react"
import { Button } from "@/components/ui/button"
import { activeLyricsLine, centeredLyricsScroll, findLyricsWithRetry, lyricsLineState, type LyricsResult } from "@/lib/lyrics"
import type { Track } from "@/lib/types"
import { cn } from "@/lib/utils"
import { usePlayer } from "@/stores/player"

/** Preview cards keep the active line in the upper third (the lines that follow stay readable below it). */
const PREVIEW_ANCHOR = 0.3

/** `preview`: Spotify-style "Vista previa de la letra" card for the desktop side panel (big bold lines, white highlight). */
export function LyricsPanel({ track, className, scrollable = false, preview = false, title, onExpand }: { track: Track; className?: string; scrollable?: boolean; preview?: boolean; title?: string; onExpand?: () => void }) {
  const position = usePlayer((s) => s.position)
  const duration = usePlayer((s) => s.duration)
  const lookupDuration = track.duration || duration
  const key = `${track.id}:${track.title}:${track.artist}:${lookupDuration}`
  const [state, setState] = useState<{ key: string; result?: LyricsResult | null; error?: string }>({ key: "" })
  const [retry, setRetry] = useState(0)
  const currentRef = useRef<HTMLElement>(null)
  const linesRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const [headHeight, setHeadHeight] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState({ key })
    // Retries quietly with backoff (the "Buscando letra…" state stays); the error only shows when all attempts failed.
    findLyricsWithRetry({ ...track, duration: lookupDuration }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setState({ key, result }) })
      .catch(() => { if (!controller.signal.aborted) setState({ key, error: "No se ha podido cargar la letra." }) })
    return () => controller.abort()
    // The lookup key captures the track metadata; position updates must not refetch lyrics.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retry])

  // Back online after giving up: try again by itself.
  const failed = state.key === key && !!state.error
  useEffect(() => {
    if (!failed) return
    const again = () => setRetry((value) => value + 1)
    window.addEventListener("online", again)
    return () => window.removeEventListener("online", again)
  }, [failed])

  const current = state.key === key ? state : { key }
  const result = current.result
  const active = result ? activeLyricsLine(result.lines, position) : -1
  const floatingHead = preview && scrollable

  // Give the first and last synced lines enough space to reach the centre as well.
  useLayoutEffect(() => {
    const lines = linesRef.current
    const viewport = lines?.closest<HTMLElement>("[data-lyrics-viewport], [data-slot=scroll-area-viewport]")
    if (!lines || !viewport) return
    const measure = () => lines.closest("section")?.style.setProperty("--lyrics-center-space", `${Math.max(0, (viewport.clientHeight - (floatingHead ? headHeight : 0)) / 2)}px`)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [result, floatingHead, headHeight])

  useEffect(() => {
    const line = active >= 0 ? currentRef.current : null
    // Only ever scroll the lyrics' own scroller (never the side panel or the page around the card).
    const viewport = floatingHead ? viewportRef.current : line?.closest<HTMLElement>("[data-lyrics-viewport], [data-slot=scroll-area-viewport]")
    if (!viewport) return
    if (!line) { if (floatingHead) viewport.scrollTo({ top: 0 }); return } // song start: first lines in view
    const rect = line.getBoundingClientRect(), bounds = viewport.getBoundingClientRect()
    const head = viewport.parentElement?.querySelector<HTMLElement>(":scope > [data-lyrics-head]")?.offsetHeight ?? 0 // header over the lines
    viewport.scrollTo({
      top: centeredLyricsScroll({ scrollTop: viewport.scrollTop, lineTop: rect.top, lineHeight: rect.height, viewportTop: bounds.top, viewportHeight: viewport.clientHeight, scrollHeight: viewport.scrollHeight, headerHeight: head, anchor: floatingHead ? PREVIEW_ANCHOR : 0.5 }),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    })
  }, [active, key, headHeight, floatingHead])

  // Preview cards: the header floats over the scroller; its height drives the spacer and the fade of the lines.
  useEffect(() => {
    const head = headRef.current
    if (!floatingHead || !head) return
    const observer = new ResizeObserver(() => setHeadHeight(head.offsetHeight))
    observer.observe(head)
    return () => observer.disconnect()
  }, [floatingHead])

  const header = (
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">{title ?? (preview ? "Vista previa de la letra" : <><Mic className="size-4" /> Letras</>)}</h3>
      {onExpand ? (
        <Button variant="ghost" size="icon" className="-my-2 -mr-2 size-9 rounded-full bg-black/20 text-foreground hover:bg-black/30" aria-label="Ampliar letra" onClick={onExpand}><Maximize2 className="size-4" /></Button>
      ) : result && !result.instrumental && <span className="text-xs text-muted-foreground">{result.lines.length ? "Sincronizadas" : "Sin sincronizar"}</span>}
    </div>
  )
  const body = (
    <>
      {current.result === undefined && !current.error && (
        <p role="status" className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Buscando letra…</p>
      )}
      {current.error && (
        <div role="status" className="flex flex-col items-start gap-3 py-2">
          <p className="text-sm text-muted-foreground">{current.error}</p>
          <Button variant="secondary" className="h-9 rounded-full bg-white/10 px-4 hover:bg-white/15" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>
        </div>
      )}
      {result === null && <p className="py-3 text-sm text-muted-foreground">No hay letra para esta canción.</p>}
      {result?.instrumental && <p className="py-3 text-sm text-muted-foreground">Esta canción es instrumental.</p>}
    </>
  )
  // `ghost`: the blurred copy painted inside the floating header (no focus, no ref, no clicks).
  const renderLines = (ghost = false) => result && !result.instrumental ? (result.lines.length ? (
    <div ref={ghost ? undefined : linesRef} style={preview && scrollable ? { paddingBottom: "var(--lyrics-center-space, 0px)" } : { paddingBlock: "var(--lyrics-center-space, 0px)" }} className={cn("flex flex-col", preview ? "gap-2" : "gap-3")}>
      {result.lines.map((line, index) => line.text ? (
        <button key={`${line.time}:${index}`} ref={!ghost && index === active ? (node) => { currentRef.current = node } : undefined} data-lyrics-state={lyricsLineState(index, active)} type="button" tabIndex={ghost ? -1 : undefined} aria-current={index === active ? "true" : undefined} aria-label={`Ir a ${Math.floor(line.time / 60)}:${String(Math.floor(line.time % 60)).padStart(2, "0")}`} onClick={ghost ? undefined : () => usePlayer.getState().seek(line.time)} className={cn("rounded-sm py-1 text-left break-words transition-[color,opacity,scale] duration-300 ease-out motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-ring", preview ? "text-xl leading-snug font-bold" : "text-lg leading-relaxed font-semibold", index === active ? (preview ? "text-foreground scale-[1.02]" : "text-primary scale-[1.01]") : index < active ? "text-foreground/30 hover:text-foreground/70" : preview ? "text-foreground/55 hover:text-foreground/80" : "text-muted-foreground hover:text-foreground")}>
          {line.text}
        </button>
      ) : <div key={`${line.time}:${index}`} ref={!ghost && index === active ? (node) => { currentRef.current = node } : undefined} className="h-3" aria-hidden />)}
    </div>
  ) : <p className="text-base leading-relaxed whitespace-pre-line text-foreground/85">{result.text}</p>) : null
  const lines = renderLines()

  // The blurred copy follows the real scroll position (set imperatively: no re-render per scroll frame).
  const syncGhost = () => {
    const ghost = ghostRef.current, viewport = viewportRef.current
    if (ghost && viewport) ghost.style.transform = `translateY(${(headRef.current?.offsetHeight ?? 0) - viewport.scrollTop}px)`
  }
  useLayoutEffect(syncGhost)

  // Preview cards: the lines scroll under a translucent header with the player bar's blur. backdrop-filter does not
  // reach this nested scroller inside the masked full-player scroll area, so the header paints its own blurred copy
  // of the lines (kept in sync with the scroll) while the real lines melt away under it: same look everywhere.
  if (floatingHead) return (
    <section aria-label="Letras" className="relative min-w-0 rounded-t-[inherit]" style={{ "--lyrics-head": `${headHeight}px` } as CSSProperties}>
      <div ref={headRef} data-lyrics-head="" className={cn("absolute inset-x-0 top-0 z-10 rounded-t-[inherit] !pb-3", className)}>
        <div aria-hidden className="lyrics-head-glass pointer-events-none absolute inset-x-0 top-0 -bottom-6 overflow-hidden rounded-t-[inherit]">
          {lines && (
            <div className="absolute inset-0 overflow-hidden blur-[24px] saturate-[1.4]">
              <div ref={ghostRef} inert className={cn("!pt-1 will-change-transform", className)}>{body}{renderLines(true)}</div>
            </div>
          )}
        </div>
        <div className="relative">{header}</div>
      </div>
      <div ref={viewportRef} data-lyrics-viewport="" onScroll={syncGhost} className="lyrics-under-head max-h-96 overflow-y-auto overscroll-contain [scrollbar-width:none]">
        <div className={cn("!pt-1", className)} style={{ marginTop: headHeight }}>{body}{lines}</div>
      </div>
    </section>
  )

  return (
    <section aria-label="Letras" className={cn("min-w-0 px-4 py-5", className)}>
      <div className="mb-4">{header}</div>
      {body}
      {lines && <div data-lyrics-viewport={scrollable ? "" : undefined} className={cn(scrollable && "max-h-72 overflow-y-auto overscroll-contain pr-2 [scrollbar-width:thin]")}>{lines}</div>}
    </section>
  )
}
