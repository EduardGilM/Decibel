"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Loader2, Play, Search, X } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { usePrepareTrack } from "@/hooks/use-prepare-track"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { Kbd } from "@/components/ui/kbd"
import { searchHref, useSearch } from "@/stores/search"
import { syncRecentSearches, useRecentScope } from "@/lib/profile/search-sync"
import { tracksOf } from "@/lib/recent-searches"
import { usePlayer } from "@/stores/player"
import { useProvider } from "@/lib/providers"
import type { SearchFilter, Track } from "@/lib/types"
import { Cover } from "./cover"
import { SwipeToQueue } from "./swipe-to-queue"
import { TrackSaveButtons } from "./track-save-buttons"
import { glass } from "@/components/ui/popover"

const EMPTY_TRACKS: Track[] = []
const searchText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()

function recentMatch(tracks: Track[], query: string) {
  if (query.length < 3) return undefined
  const words = searchText(query).split(/\s+/)
  return tracks.find((track) => words.every((word) => searchText(`${track.title} ${track.artist}`).includes(word)))
}
/** The add-to-playlist popover is portaled; using it must not dismiss the suggestions it was opened from. */
const inPopover = (target: EventTarget | null) => target instanceof Element && !!target.closest("[data-slot=popover-content]")

/**
 * Typing previews songs over the current page; Enter opens the full search.
 * Mobile also keeps the compact home field in place while suggesting songs.
 */
export function TopSearch({ mobile = false, className, placeholder = "¿Qué quieres reproducir?" }: { mobile?: boolean; className?: string; placeholder?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const onSearch = pathname.startsWith("/search")
  const urlQ = onSearch ? params.get("q") ?? "" : ""
  const q = useSearch((s) => s.q)
  const setQ = useSearch((s) => s.setQ)
  const provider = useProvider()
  const { scope, legacy: legacyScope } = useRecentScope()
  const rows = useSearch((s) => s.rows[scope])
  // Until the first sync (or the first change), the list this device kept before 0.1.10.
  const legacy = useSearch((s) => s.recent[legacyScope])
  const recentTracks = useMemo(() => (rows ? tracksOf(rows) : legacy ?? EMPTY_TRACKS), [rows, legacy])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [retry, setRetry] = useState(0)
  const [preview, setPreview] = useState<{ key: string; tracks?: Track[]; error?: string }>({ key: "" })
  const ref = useRef<HTMLInputElement>(null)
  const container = useRef<HTMLDivElement>(null)
  /** Suggestions are portaled to <body>: inside the page scroller Chromium drops their backdrop blur. */
  const panel = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number }>()
  const activeOption = useRef<HTMLButtonElement>(null)
  const listId = useId()
  const query = q.trim()
  const key = JSON.stringify([scope, query])
  const current = preview.key === key ? preview : undefined
  const tracks = query ? current?.tracks || EMPTY_TRACKS : recentTracks
  const loading = !!query && !current?.tracks && !current?.error
  const predicted = loading ? recentMatch(recentTracks, query) : tracks[active >= 0 ? active : 0]
  usePrepareTrack(open && (query || active >= 0) ? predicted : undefined)

  // Back/forward and shared links update the draft, without submitting further edits.
  useEffect(() => {
    setQ(urlQ)
    setOpen(false)
    setActive(-1)
  }, [pathname, urlQ, setQ])

  useEffect(() => {
    if (!open || !query) return
    let alive = true
    const controller = new AbortController()
    setPreview({ key })
    const timer = setTimeout(() => {
      provider.search(query, controller.signal, "tracks")
        .then((result) => { if (alive) setPreview({ key, tracks: result.tracks.slice(0, 6) }) })
        .catch(() => { if (alive) setPreview({ key, error: "No se pudieron cargar las sugerencias." }) })
    }, 300)
    return () => { alive = false; clearTimeout(timer); controller.abort() }
  }, [open, query, key, provider, retry])

  // Follow the input while the portaled panel is open (scroll, resize, layout shifts).
  useEffect(() => {
    if (!open) return
    let frame = 0
    const track = () => {
      const box = container.current?.getBoundingClientRect()
      if (box) setAnchor((prev) => (prev && prev.left === box.left && prev.top === box.bottom + 8 && prev.width === box.width ? prev : { left: box.left, top: box.bottom + 8, width: box.width }))
      frame = requestAnimationFrame(track)
    }
    track()
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node) && !inPopover(event.target)) { setOpen(false); setActive(-1) }
    }
    document.addEventListener("pointerdown", dismiss)
    return () => document.removeEventListener("pointerdown", dismiss)
  }, [open])

  useEffect(() => { activeOption.current?.scrollIntoView({ block: "nearest" }) }, [active])

  // regain focus after navigating from another page, or when asked via ?focus=1
  useEffect(() => {
    const { refocus, setRefocus } = useSearch.getState()
    const el = ref.current
    if (!el || el.offsetParent === null) return
    if (refocus || (onSearch && params.get("focus"))) {
      el.focus()
      const n = el.value.length
      el.setSelectionRange(n, n)
      setRefocus(false)
    }
  }, [onSearch, params])

  // "/" and Ctrl/Cmd+K (dispatched by the audio engine's shortcut handler)
  useEffect(() => {
    const focus = () => {
      const el = ref.current
      if (el && el.offsetParent !== null) {
        el.focus()
        el.select()
      } else {
        useSearch.getState().setRefocus(true)
        router.push("/search/?focus=1")
      }
    }
    window.addEventListener("decibel:focus-search", focus)
    return () => window.removeEventListener("decibel:focus-search", focus)
  }, [router])

  function change(v: string) {
    setQ(v)
    setOpen(true)
    setActive(-1)
  }

  // keeps the tab you are on (also Podcasts, which shows the charts while the search is empty)
  function submit(type: SearchFilter | "podcasts" = params.get("type") === "albums" ? "albums" : params.get("type") === "tracks" ? "tracks" : params.get("type") === "artists" ? "artists" : params.get("type") === "podcasts" ? "podcasts" : "all") {
    setOpen(false)
    setActive(-1)
    ref.current?.blur()
    router.push(searchHref(q, type), { scroll: false })
  }

  function select(track: Track) {
    useSearch.getState().remember(scope, track)
    usePlayer.getState().playList([track], 0, `search:${query || track.title}`)
    setOpen(false)
    setActive(-1)
    ref.current?.blur()
  }

  return (
    <div className={cn("min-w-0 items-center gap-2", mobile ? "flex" : "hidden md:flex", className)}>
      <div ref={container} className="relative min-w-0 flex-1" onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node) && !panel.current?.contains(event.relatedTarget as Node) && !inPopover(event.relatedTarget)) { setOpen(false); setActive(-1) }
      }}>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground md:left-3.5 md:size-5" />
        <Input
          ref={ref}
          id="search-input"
          type="search"
          value={q}
          onChange={(e) => change(e.target.value)}
          onFocus={() => { setOpen(true); void syncRecentSearches() }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === "Escape") { e.preventDefault(); setOpen(false); setActive(-1) }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault()
              setOpen(true)
              setActive((index) => tracks.length ? e.key === "ArrowDown" ? Math.min(index + 1, tracks.length - 1) : index < 0 ? tracks.length - 1 : Math.max(index - 1, 0) : -1)
            }
            if (e.key === "Enter") {
              e.preventDefault()
              if (open && active >= 0 && tracks[active]) select(tracks[active])
              else submit()
            }
          }}
          placeholder={placeholder}
          aria-label="Buscar"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && active >= 0 && tracks[active] ? `${listId}-${active}` : undefined}
          maxLength={300}
          autoComplete="off"
          enterKeyHint="search"
          className="h-10 rounded-full border-0 bg-secondary/80 pr-10 pl-9 text-base shadow-none focus-visible:bg-secondary md:h-11 md:pl-11 md:text-sm [&::-webkit-search-cancel-button]:hidden"
        />
        {q && (
          <Button variant="ghost" size="icon" className="absolute top-1/2 right-1 size-8 -translate-y-1/2 rounded-full md:right-1.5" aria-label="Borrar búsqueda" onClick={() => { change(""); ref.current?.focus() }}>
            <X />
          </Button>
        )}
        <Kbd className={cn("absolute top-1/2 right-3 hidden -translate-y-1/2", !q && "lg:inline-flex")}>Ctrl K</Kbd>
        {open && (
          anchor && createPortal(<div ref={panel} className={cn(glass.panel, "fixed z-40 overflow-hidden border-0! text-popover-foreground")} style={{ left: anchor.left, top: anchor.top, width: anchor.width }}>
            <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
              <h2 className="text-sm font-semibold">{query ? "Canciones" : "Búsquedas recientes"}</h2>
              {!query && tracks.length > 0 && <button type="button" className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" onMouseDown={(event) => event.preventDefault()} onClick={() => { useSearch.getState().clearRecent(scope); setActive(-1); ref.current?.focus() }}>Borrar todo</button>}
            </div>
            <div id={listId} role="listbox" aria-label={query ? "Canciones sugeridas" : "Búsquedas recientes"} aria-busy={loading} className="max-h-[min(28rem,calc(100dvh-12rem))] overflow-y-auto overscroll-contain px-2 pb-2">
              {loading && <p role="status" className="flex items-center gap-2 px-2 py-5 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Buscando canciones…</p>}
              {current?.error && query && (
                <div role="status" className="px-2 py-3 text-sm text-muted-foreground">
                  <p>{current.error}</p>
                  <Button variant="link" size="sm" className="px-0" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button>
                </div>
              )}
              {!loading && !current?.error && !tracks.length && <p role="status" className="px-2 py-4 text-sm text-muted-foreground">{query ? "No se han encontrado canciones." : "Aquí aparecerán las canciones que elijas al buscar."}</p>}
              {tracks.map((track, index) => (
                <div key={track.id} role="presentation" className={cn("group flex items-center rounded-[10px] hover:bg-white/8", active === index && "bg-white/10")} onPointerMove={(event) => { if (event.pointerType === "mouse") setActive(index) }}>
                  <SwipeToQueue track={track} className="flex-1">
                    <button id={`${listId}-${index}`} ref={active === index ? activeOption : undefined} type="button" role="option" aria-selected={active === index} tabIndex={-1} className="flex w-full min-w-0 items-center gap-3 rounded-md p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" onMouseDown={(event) => event.preventDefault()} onClick={() => select(track)}>
                      <span className="relative shrink-0">
                        <Cover coverArt={track.coverArt} alt={track.album} size={96} rounded="sm" className="size-12" />
                        <span aria-hidden className={cn("absolute inset-0 flex items-center justify-center rounded-sm bg-black/50 opacity-0 group-hover:opacity-100", active === index && "opacity-100")}><Play className="size-5 fill-white text-white" /></span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{track.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">Canción · {track.artist}</span>
                      </span>
                    </button>
                  </SwipeToQueue>
                  <TrackSaveButtons track={track} buttonClassName="size-9" />
                  {!query && <Button variant="ghost" size="icon" className="mr-1 size-10 shrink-0 rounded-full text-muted-foreground" aria-label={`Quitar ${track.title} de búsquedas recientes`} onClick={() => { useSearch.getState().forget(scope, track.id); setActive(-1); ref.current?.focus() }}><X className="size-4" /></Button>}
                </div>
              ))}
            </div>
            {query && (
              <div className="flex border-t border-white/10">
                <button type="button" className="flex min-w-0 flex-1 items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => submit("all")}>Ver todos los resultados <Kbd>Enter</Kbd></button>
                <button type="button" className="shrink-0 border-l border-white/10 px-4 py-3 text-sm hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-ring" onClick={() => submit("albums")}>Álbumes</button>
              </div>
            )}
          </div>, document.body)
        )}
      </div>
    </div>
  )
}
