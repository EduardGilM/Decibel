"use client"

import { Flame, Loader2, Share2, Sparkles, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { toast } from "sonner"
import { ArtistAvatar, Cover } from "@/components/music/cover"
import { Dither } from "@/components/ui/dither"
import { useProvider } from "@/lib/providers"
import { useCoverColor } from "@/lib/use-color"
import { cn } from "@/lib/utils"
import {
  dayPart, formatMinutes, hourRange, minutesOf, plays, RANGES, WEEKDAYS_PLURAL,
  type WrappedRange, type WrappedStats,
} from "@/lib/wrapped"
import { renderWrappedImage, shareWrappedImage } from "./share-image"

/** Seconds each story stays before moving on by itself (the summary waits for you). */
export const STORY_MS = 6500
const HOLD_MS = 220 // press longer than this = pause, not a tap
const CLOSE_PX = 110 // drag down this far to close

interface Story { key: string; cover?: string; auto: boolean; node: ReactNode }

/** Staggered entrance (fade + rise); off with reduced motion. */
function Enter({ delay = 0, className, children }: { delay?: number; className?: string; children: ReactNode }) {
  return (
    <div className={cn("animate-in fade-in-0 slide-in-from-bottom-6 fill-mode-both duration-700 ease-out motion-reduce:animate-none", className)} style={{ "--tw-animation-delay": `${delay}ms` } as CSSProperties}>
      {children}
    </div>
  )
}

/** Number that counts up from 0 once (ease-out, ~1.2 s). */
function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setShown(value); return }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1200)
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return <>{formatMinutes(shown)}</>
}

/** Full-bleed background in the colour of the story's artwork, dithered against banding. */
function Backdrop({ cover }: { cover?: string }) {
  const provider = useProvider()
  const tint = useCoverColor(provider.coverUrl(cover, 64), provider.coverColor?.(cover))
  const color = tint ?? "var(--primary)"
  return (
    <div aria-hidden className="absolute inset-0 animate-in fade-in-0 duration-500" style={{
      backgroundColor: "#0b0b0d",
      backgroundImage: `radial-gradient(130% 75% at 50% 0%, color-mix(in oklab, ${color} 78%, #0b0b0d) 0%, color-mix(in oklab, ${color} 38%, #0b0b0d) 48%, #0b0b0d 100%)`,
    }}>
      <Dither opacity={0.08} />
    </div>
  )
}

const Kicker = ({ children }: { children: ReactNode }) => <p className="text-sm font-semibold tracking-[0.14em] text-white/70 uppercase">{children}</p>
const Big = ({ children, className }: { children: ReactNode; className?: string }) => <h2 className={cn("text-4xl leading-[1.05] font-extrabold tracking-tight text-balance text-white", className)}>{children}</h2>

function RangePills({ value, onChange }: { value: WrappedRange; onChange: (r: WrappedRange) => void }) {
  return (
    <div className="flex flex-wrap justify-center gap-2" data-wrapped-control>
      {RANGES.map((r) => (
        <button key={r.value} type="button" aria-pressed={value === r.value} onClick={() => onChange(r.value)}
          className={cn("h-9 rounded-full px-4 text-[13px] font-semibold transition-colors", value === r.value ? "bg-white text-black" : "bg-white/15 text-white hover:bg-white/25")}>
          {r.label}
        </button>
      ))}
    </div>
  )
}

function RankRow({ i, title, subtitle, art, delay }: { i: number; title: string; subtitle?: string; art: ReactNode; delay: number }) {
  return (
    <Enter delay={delay} className="flex items-center gap-3">
      <span className="w-5 shrink-0 text-right text-lg font-bold text-white/60 tabular-nums">{i + 1}</span>
      <div className="size-14 shrink-0">{art}</div>
      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-white">{title}</p>
        {subtitle && <p className="truncate text-sm text-white/65">{subtitle}</p>}
      </div>
    </Enter>
  )
}

/** Real artist photos when the provider has them (best effort, 5 s); otherwise the cover of their top song. */
function useArtistPhotos(stats: WrappedStats) {
  const provider = useProvider()
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const ids = stats.topArtists.map((a) => a.artistId).filter(Boolean).join("|")
  useEffect(() => {
    let alive = true
    for (const id of ids ? ids.split("|") : []) {
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000))
      Promise.race([provider.getArtist(id), timeout])
        .then((artist) => { if (alive && artist.coverArt) setPhotos((p) => ({ ...p, [id]: artist.coverArt! })) })
        .catch(() => {})
    }
    return () => { alive = false }
  }, [ids, provider])
  return photos
}

const dateLabel = (t: number, year = false) => new Date(t).toLocaleDateString("es-ES", { day: "numeric", month: "long", ...(year ? { year: "numeric" } : {}) })

export function periodTitle(range: WrappedRange, now = new Date()) {
  if (range === "month") { const m = now.toLocaleDateString("es-ES", { month: "long", year: "numeric" }); return m[0].toUpperCase() + m.slice(1) }
  if (range === "year") return String(now.getFullYear())
  return "Desde siempre"
}

function buildStories(stats: WrappedStats, range: WrappedRange, onRange: (r: WrappedRange) => void, photos: Record<string, string>, share: ReactNode): Story[] {
  const r = RANGES.find((x) => x.value === range)!
  const top = stats.topTracks[0]
  const minutes = minutesOf(stats.seconds)
  const stories: Story[] = [{
    key: "intro", cover: top?.track.coverArt, auto: true,
    node: (
      <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
        <Enter><Sparkles className="mx-auto size-10 text-white" /></Enter>
        <Enter delay={120}><Big className="text-5xl">Tu Wrapped</Big></Enter>
        <Enter delay={240}><p className="text-lg text-white/80">Lo que más has escuchado {r.title}.</p></Enter>
        <Enter delay={360}><RangePills value={range} onChange={onRange} /></Enter>
        <Enter delay={520}><p className="text-sm text-white/55">Toca a la derecha para avanzar</p></Enter>
      </div>
    ),
  }]

  if (minutes >= 1) stories.push({
    key: "minutes", cover: top?.track.coverArt, auto: true,
    node: (
      <div className="flex h-full flex-col justify-center gap-4">
        <Enter><Kicker>Has escuchado</Kicker></Enter>
        <Enter delay={120}><p className="text-7xl font-extrabold tracking-tight text-white tabular-nums sm:text-8xl"><CountUp value={minutes} /></p></Enter>
        <Enter delay={240}><Big>minutos de música</Big></Enter>
        <Enter delay={420}><p className="text-lg text-white/80">{stats.listens} escuchas de {stats.distinctTracks} canciones en {stats.activeDays} {stats.activeDays === 1 ? "día" : "días"}.</p></Enter>
        {stats.partialMinutes && <Enter delay={560}><p className="text-sm text-white/55">Como mínimo: hasta la 0.1.6 solo se guardaban los primeros 30 s de cada escucha.</p></Enter>}
      </div>
    ),
  })

  if (stats.topTracks.length) stories.push({
    key: "tracks", cover: top.track.coverArt, auto: true,
    node: (
      <div className="flex h-full flex-col justify-center gap-5">
        <Enter><Kicker>Tus canciones top</Kicker></Enter>
        <Enter delay={100}><Cover coverArt={top.track.coverArt} alt={top.track.title} size={800} rounded="lg" className="w-44 shadow-2xl shadow-black/40" /></Enter>
        <div className="flex flex-col gap-3">
          {stats.topTracks.map((t, i) => (
            <RankRow key={t.track.id} i={i} delay={220 + i * 90} title={t.track.title} subtitle={`${t.track.artist} · ${plays(t.plays)}`}
              art={<Cover coverArt={t.track.coverArt} alt={t.track.title} size={500} rounded="sm" className="size-14" />} />
          ))}
        </div>
      </div>
    ),
  })

  if (stats.topArtists.length) {
    const a0 = stats.topArtists[0]
    stories.push({
      key: "artists", cover: a0.coverArt, auto: true,
      node: (
        <div className="flex h-full flex-col justify-center gap-5">
          <Enter><Kicker>Tus artistas top</Kicker></Enter>
          <Enter delay={100}><ArtistAvatar coverArt={(a0.artistId && photos[a0.artistId]) || a0.coverArt} name={a0.name} size={800} className="w-44 shadow-2xl shadow-black/40" /></Enter>
          <div className="flex flex-col gap-3">
            {stats.topArtists.map((a, i) => (
              <RankRow key={a.id} i={i} delay={220 + i * 90} title={a.name} subtitle={`${plays(a.plays)}${a.seconds >= 60 ? ` · ${formatMinutes(minutesOf(a.seconds))} min` : ""}`}
                art={<ArtistAvatar coverArt={(a.artistId && photos[a.artistId]) || a.coverArt} name={a.name} size={500} className="size-14" />} />
            ))}
          </div>
        </div>
      ),
    })
  }

  if (stats.topAlbums.length) stories.push({
    key: "albums", cover: stats.topAlbums[0].coverArt, auto: true,
    node: (
      <div className="flex h-full flex-col justify-center gap-5">
        <Enter><Kicker>Tus álbumes top</Kicker></Enter>
        <Enter delay={100}><Cover coverArt={stats.topAlbums[0].coverArt} alt={stats.topAlbums[0].name} size={800} rounded="lg" className="w-44 shadow-2xl shadow-black/40" /></Enter>
        <div className="flex flex-col gap-3">
          {stats.topAlbums.map((a, i) => (
            <RankRow key={a.id} i={i} delay={220 + i * 90} title={a.name} subtitle={`${a.artist} · ${plays(a.plays)}`}
              art={<Cover coverArt={a.coverArt} alt={a.name} size={500} rounded="sm" className="size-14" />} />
          ))}
        </div>
      </div>
    ),
  })

  const rep = stats.mostRepeated
  if (rep) stories.push({
    key: "repeat", cover: rep.track.coverArt, auto: true,
    node: (
      <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
        <Enter><Kicker>La que más has repetido</Kicker></Enter>
        <Enter delay={120}><Cover coverArt={rep.track.coverArt} alt={rep.track.title} size={800} rounded="lg" className="w-64 shadow-2xl shadow-black/50 sm:w-72" /></Enter>
        <Enter delay={260}><Big>{rep.track.title}</Big><p className="mt-1 text-lg text-white/75">{rep.track.artist}</p></Enter>
        <Enter delay={400}><p className="text-lg font-semibold text-white">La has puesto {plays(rep.plays)}</p>
          {rep.bestDayPlays >= 2 && <p className="text-white/70">{rep.bestDayPlays} de ellas el {dateLabel(rep.bestDay)}</p>}</Enter>
      </div>
    ),
  })

  if (stats.peakHour || stats.peakWeekday) {
    const h = stats.peakHour, w = stats.peakWeekday
    stories.push({
      key: "moment", cover: stats.topTracks[1]?.track.coverArt ?? top?.track.coverArt, auto: true,
      node: (
        <div className="flex h-full flex-col justify-center gap-4">
          <Enter><Kicker>Tu momento</Kicker></Enter>
          {h && <Enter delay={120}><Big className="text-5xl">Lo tuyo es escuchar {dayPart(h.hour)}</Big><p className="mt-2 text-lg text-white/80">Sobre todo entre las {hourRange(h.hour).replace("–", " y las ")}: {Math.round(h.share * 100)} % de tus escuchas.</p></Enter>}
          {w && <Enter delay={300}><p className={cn("font-bold text-white", h ? "text-2xl" : "text-5xl")}>{h ? `Y ${WEEKDAYS_PLURAL[w.day]}, tu día` : `${WEEKDAYS_PLURAL[w.day][0].toUpperCase()}${WEEKDAYS_PLURAL[w.day].slice(1)}`}</p>
            <p className="mt-1 text-white/70">{w.plays} escuchas ese día de la semana.</p></Enter>}
        </div>
      ),
    })
  }

  const s = stats.streak
  if (s) stories.push({
    key: "streak", cover: stats.topAlbums[1]?.coverArt ?? top?.track.coverArt, auto: true,
    node: (
      <div className="flex h-full flex-col justify-center gap-4">
        <Enter><Flame className="size-12 text-white" /></Enter>
        <Enter delay={100}><Kicker>Tu mejor racha</Kicker></Enter>
        <Enter delay={200}><p className="text-7xl font-extrabold tracking-tight text-white tabular-nums">{s.longest}</p><Big>días seguidos escuchando</Big></Enter>
        <Enter delay={380}><p className="text-lg text-white/80">Del {dateLabel(s.longestFrom)} al {dateLabel(s.longestTo)}.</p>
          {s.current >= 2 && s.current !== s.longest && <p className="text-white/70">Ahora llevas {s.current} días.</p>}
          {s.current >= 2 && s.current === s.longest && <p className="text-white/70">Y sigue viva: no la rompas hoy.</p>}</Enter>
      </div>
    ),
  })

  if (stats.genre) stories.push({
    key: "genre", cover: top?.track.coverArt, auto: true,
    node: (
      <div className="flex h-full flex-col justify-center gap-4">
        <Enter><Kicker>Tu género</Kicker></Enter>
        <Enter delay={120}><Big className="text-6xl">{stats.genre.name}</Big></Enter>
        <Enter delay={260}><p className="text-lg text-white/80">{Math.round(stats.genre.share * 100)} % de lo que has escuchado con género.</p></Enter>
      </div>
    ),
  })

  stories.push({ key: "summary", cover: top?.track.coverArt, auto: false, node: share })
  return stories
}

function Summary({ stats, range, photos }: { stats: WrappedStats; range: WrappedRange; photos: Record<string, string> }) {
  const provider = useProvider()
  const top = stats.topTracks[0], artist = stats.topArtists[0]
  const tint = useCoverColor(provider.coverUrl(top?.track.coverArt, 64), provider.coverColor?.(top?.track.coverArt))
  const [busy, setBusy] = useState(false)
  const title = periodTitle(range)
  const share = async () => {
    setBusy(true)
    try {
      const blob = await renderWrappedImage(stats, provider, { title, tint })
      const text = `Mi Wrapped de Decibel (${title.toLowerCase()}): ${formatMinutes(minutesOf(stats.seconds))} min${top ? `, sobre todo «${top.track.title}»` : ""}.`
      const result = await shareWrappedImage(blob, text)
      if (result === "downloaded") toast("Imagen descargada", { description: "Tu resumen se ha guardado como decibel-wrapped.jpg." })
    } catch {
      toast.error("No se pudo crear la imagen")
    } finally { setBusy(false) }
  }
  const facts: [string, string][] = [["Minutos", `${formatMinutes(minutesOf(stats.seconds))}${stats.partialMinutes ? "+" : ""}`]]
  if (stats.streak) facts.push(["Racha", `${stats.streak.longest} días`])
  if (stats.peakHour) facts.push(["Tu hora", hourRange(stats.peakHour.hour)])
  else if (stats.peakWeekday) facts.push(["Tu día", WEEKDAYS_PLURAL[stats.peakWeekday.day]])
  if (stats.genre) facts.push(["Género", stats.genre.name])
  return (
    <div className="flex h-full flex-col justify-center gap-5">
      <Enter className="rounded-3xl bg-white/10 p-5 backdrop-blur-md">
        <p className="text-xs font-semibold tracking-[0.14em] text-white/65 uppercase">Tu Wrapped · {title}</p>
        <div className="mt-4 flex items-center gap-4">
          {top && <Cover coverArt={top.track.coverArt} alt={top.track.title} size={800} rounded="lg" className="w-28 shadow-xl shadow-black/40" />}
          <div className="min-w-0">
            {top && <><p className="text-xs text-white/60">Canción top</p><p className="truncate text-lg font-bold text-white">{top.track.title}</p></>}
            {artist && <><p className="mt-1 text-xs text-white/60">Artista top</p><p className="flex items-center gap-2 truncate font-semibold text-white">
              <ArtistAvatar coverArt={(artist.artistId && photos[artist.artistId]) || artist.coverArt} name={artist.name} size={160} className="size-6" />{artist.name}</p></>}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4">
          <div><p className="text-xs text-white/60">Canciones</p>{stats.topTracks.slice(0, 5).map((t, i) => <p key={t.track.id} className="truncate text-sm text-white"><span className="mr-1.5 text-white/55 tabular-nums">{i + 1}</span>{t.track.title}</p>)}</div>
          <div><p className="text-xs text-white/60">Artistas</p>{stats.topArtists.slice(0, 5).map((a, i) => <p key={a.id} className="truncate text-sm text-white"><span className="mr-1.5 text-white/55 tabular-nums">{i + 1}</span>{a.name}</p>)}</div>
        </div>
        <div className={cn("mt-5 grid gap-3", facts.length > 2 ? "grid-cols-3" : "grid-cols-2")}>
          {facts.slice(0, 3).map(([label, value]) => <div key={label}><p className="text-xs text-white/60">{label}</p><p className="truncate text-lg font-bold text-white tabular-nums">{value}</p></div>)}
        </div>
      </Enter>
      <Enter delay={200} className="flex justify-center">
        <button type="button" data-wrapped-control onClick={share} disabled={busy}
          className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-base font-semibold text-black transition-transform active:scale-95 disabled:opacity-70">
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Share2 className="size-5" />} Compartir
        </button>
      </Enter>
    </div>
  )
}

/** Shown instead of the stories when the period has too few real listens. */
export function WrappedEmpty({ stats, range, onRange, onClose }: { stats: WrappedStats; range: WrappedRange; onRange: (r: WrappedRange) => void; onClose: () => void }) {
  const r = RANGES.find((x) => x.value === range)!
  return (
    <div className="relative h-full overflow-hidden">
    <Backdrop cover={stats.topTracks[0]?.track.coverArt} />
    <button type="button" aria-label="Cerrar" onClick={onClose}
      className="absolute right-2 z-20 flex size-11 items-center justify-center rounded-full text-white/85 hover:bg-white/10 top-[calc(var(--safe-top)+18px)]">
      <X className="size-6" />
    </button>
    <div className="relative flex h-full flex-col items-center justify-center gap-6 px-8 text-center">
      <Enter><Sparkles className="mx-auto size-10 text-white" /></Enter>
      <Enter delay={120}><Big>Aún te conocemos poco</Big></Enter>
      <Enter delay={240}><p className="text-lg text-white/80">
        {stats.listens ? `Llevas ${stats.listens} ${stats.listens === 1 ? "escucha" : "escuchas"} ${r.title}.` : `No hay escuchas ${r.title}.`} Escucha un poco más y aquí aparecerán tus canciones, artistas y rachas.
      </p></Enter>
      <Enter delay={360}><RangePills value={range} onChange={onRange} /></Enter>
      <Enter delay={480}><button type="button" onClick={onClose} className="h-11 rounded-full bg-white px-6 font-semibold text-black">Volver a Inicio</button></Enter>
    </div>
    </div>
  )
}

/**
 * Full-screen stories: tap right → next, left → back, hold → pause, drag down → close. Segment bar at the top
 * (below the status bar, `--safe-top`). Keyboard: ← → Space Esc.
 */
export function WrappedStories({ stats, range, onRange, onClose }: { stats: WrappedStats; range: WrappedRange; onRange: (r: WrappedRange) => void; onClose: () => void }) {
  const photos = useArtistPhotos(stats)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [drag, setDrag] = useState(0)
  const changeRange = useCallback((r: WrappedRange) => { onRange(r); setIndex(0) }, [onRange])
  const stories = useMemo(() => buildStories(stats, range, changeRange, photos, <Summary stats={stats} range={range} photos={photos} />), [stats, range, changeRange, photos])
  const current = stories[Math.min(index, stories.length - 1)]
  const next = useCallback(() => setIndex((i) => Math.min(i + 1, stories.length - 1)), [stories.length])
  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), [])
  const press = useRef<{ x: number; y: number; t: number; held: boolean; dragging: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next()
      else if (e.key === "ArrowLeft") prev()
      else if (e.key === "Escape") onClose()
      else if (e.key === " ") { e.preventDefault(); setPaused((p) => !p) }
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [next, prev, onClose])

  const control = (target: EventTarget | null) => Boolean((target as Element | null)?.closest?.("[data-wrapped-control], button, a"))
  const onPointerDown = (e: React.PointerEvent) => {
    if (control(e.target) || !e.isPrimary) return
    const p = { x: e.clientX, y: e.clientY, t: e.timeStamp, held: false, dragging: false, timer: undefined as ReturnType<typeof setTimeout> | undefined }
    p.timer = setTimeout(() => { p.held = true; setPaused(true) }, HOLD_MS)
    press.current = p
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch {}
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current
    if (!p) return
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    if (!p.dragging && dy > 10 && dy > Math.abs(dx)) { p.dragging = true; clearTimeout(p.timer); setPaused(true) }
    if (p.dragging) setDrag(Math.max(0, dy))
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const p = press.current
    press.current = null
    if (!p) return
    clearTimeout(p.timer)
    if (p.dragging) {
      if (e.clientY - p.y > CLOSE_PX) { onClose(); return }
      setDrag(0); setPaused(false); return
    }
    if (p.held) { setPaused(false); return }
    const width = (e.currentTarget as HTMLElement).clientWidth
    if (e.clientX < width * 0.3) prev()
    else next()
  }
  const onPointerCancel = () => { if (press.current) clearTimeout(press.current.timer); press.current = null; setDrag(0); setPaused(false) }

  return (
    <div
      className="relative h-full touch-none overflow-hidden select-none"
      style={{ transform: drag ? `translateY(${drag}px) scale(${1 - Math.min(drag, 400) / 4000})` : undefined, borderRadius: drag ? 24 : undefined, transition: drag ? "none" : "transform 200ms ease-out" }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Backdrop key={`bg-${current.key}-${range}`} cover={current.cover} />
      {/* segment progress, below the status bar */}
      <div className="absolute inset-x-0 top-0 z-10 flex gap-1 px-3 pt-[calc(var(--safe-top)+10px)]" aria-hidden>
        {stories.map((s, i) => (
          <div key={s.key} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
            <div
              key={`${s.key}-${range}-${i === index ? "on" : "off"}`}
              className="h-full origin-left rounded-full bg-white"
              onAnimationEnd={i === index ? next : undefined}
              style={i < index ? { transform: "scaleX(1)" } : i > index ? { transform: "scaleX(0)" } : s.auto
                ? { animation: `wrapped-progress ${STORY_MS}ms linear forwards`, animationPlayState: paused ? "paused" : "running" }
                : { transform: "scaleX(1)" }}
            />
          </div>
        ))}
      </div>
      <button type="button" aria-label="Cerrar" onClick={onClose} data-wrapped-control
        className="absolute right-2 z-20 flex size-11 items-center justify-center rounded-full text-white/85 hover:bg-white/10 top-[calc(var(--safe-top)+18px)]">
        <X className="size-6" />
      </button>
      <div key={`${current.key}-${range}`} className="relative mx-auto h-full max-w-md px-6 pt-[calc(var(--safe-top)+64px)] pb-[calc(env(safe-area-inset-bottom)+40px)]" aria-live="polite">
        {current.node}
      </div>
      {paused && !drag && <p className="pointer-events-none absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+14px)] text-center text-xs font-medium text-white/60">En pausa</p>}
    </div>
  )
}
