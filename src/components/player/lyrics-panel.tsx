"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Maximize2, Mic } from "lucide-react"
import { Button } from "@/components/ui/button"
import { activeLyricsLine, findLyricsWithRetry, type LyricsResult } from "@/lib/lyrics"
import type { Track } from "@/lib/types"
import { cn } from "@/lib/utils"
import { usePlayer } from "@/stores/player"

/** `preview`: Spotify-style "Vista previa de la letra" card for the desktop side panel (big bold lines, white highlight). */
export function LyricsPanel({ track, className, scrollable = false, preview = false, title, onExpand }: { track: Track; className?: string; scrollable?: boolean; preview?: boolean; title?: string; onExpand?: () => void }) {
  const position = usePlayer((s) => s.position)
  const duration = usePlayer((s) => s.duration)
  const lookupDuration = track.duration || duration
  const key = `${track.id}:${track.title}:${track.artist}:${lookupDuration}`
  const [state, setState] = useState<{ key: string; result?: LyricsResult | null; error?: string }>({ key: "" })
  const [retry, setRetry] = useState(0)
  const currentRef = useRef<HTMLButtonElement>(null)

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

  useEffect(() => {
    const line = currentRef.current
    const viewport = line?.closest<HTMLElement>("[data-lyrics-viewport], [data-slot=scroll-area-viewport]")
    if (!line || !viewport) return
    const rect = line.getBoundingClientRect(), bounds = viewport.getBoundingClientRect()
    if (rect.top < bounds.top + 24 || rect.bottom > bounds.bottom - 24) {
      viewport.scrollTo({ top: viewport.scrollTop + rect.top - bounds.top - bounds.height * 0.35, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })
    }
  }, [active, key])

  return (
    <section aria-label="Letras" className={cn("min-w-0 px-4 py-5", className)}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">{title ?? (preview ? "Vista previa de la letra" : <><Mic className="size-4" /> Letras</>)}</h3>
        {onExpand ? (
          <Button variant="ghost" size="icon" className="-my-2 -mr-2 size-9 rounded-full bg-black/20 text-foreground hover:bg-black/30" aria-label="Ampliar letra" onClick={onExpand}><Maximize2 className="size-4" /></Button>
        ) : result && !result.instrumental && <span className="text-xs text-muted-foreground">{result.lines.length ? "Sincronizadas" : "Sin sincronizar"}</span>}
      </div>
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
      {result && !result.instrumental && <div data-lyrics-viewport={scrollable ? "" : undefined} className={cn(scrollable && "max-h-72 overflow-y-auto overscroll-contain pr-2 [scrollbar-width:thin]", scrollable && preview && "max-h-80 [scrollbar-width:none]")}>{result.lines.length ? (
        <div className={cn("flex flex-col", preview ? "gap-2" : "gap-3")}>
          {result.lines.map((line, index) => line.text ? (
            <button key={`${line.time}:${index}`} ref={index === active ? currentRef : undefined} type="button" aria-current={index === active ? "true" : undefined} aria-label={`Ir a ${Math.floor(line.time / 60)}:${String(Math.floor(line.time % 60)).padStart(2, "0")}`} onClick={() => usePlayer.getState().seek(line.time)} className={cn("rounded-sm py-1 text-left break-words transition-colors focus-visible:outline-2 focus-visible:outline-ring", preview ? "text-xl leading-snug font-bold" : "text-lg leading-relaxed font-semibold", index === active ? (preview ? "text-foreground" : "text-primary") : preview ? "text-foreground/40 hover:text-foreground/80" : "text-muted-foreground hover:text-foreground")}>
              {line.text}
            </button>
          ) : <div key={`${line.time}:${index}`} className="h-3" aria-hidden />)}
        </div>
      ) : <p className="text-base leading-relaxed whitespace-pre-line text-foreground/85">{result.text}</p>}</div>}
    </section>
  )
}
