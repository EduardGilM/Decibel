"use client"

import { useRouter } from "next/navigation"
import { ArrowDownCircle, History, KeyRound, LogOut, Palette, Server, SlidersHorizontal, Users } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"
import { useCallback, useEffect, useRef, useState } from "react"
import { Sheet, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ProfileAvatar } from "@/components/profile/profile-avatar"
import { PasswordDialog } from "@/components/profile/password-dialog"
import { ThemePicker } from "@/components/theme/theme-picker"
import { useMediaQuery } from "@/hooks/use-media-query"
import { resetForProfile } from "@/lib/profile/sync"
import { clearDataCache } from "@/lib/use-data"
import { GlassButtonRow, GlassGroup } from "@/components/ui/glass-list"
import { APP_VERSION } from "@/lib/version"
import { useProfile } from "@/stores/profile"
import { usePlayer } from "@/stores/player"
import { FIXED_SERVER, useSession } from "@/stores/session"
import { useUi } from "@/stores/ui"

/** Edge zone (px) where a rightward swipe may open the panel, and the travel needed before we claim the gesture. */
const EDGE = 24
const LOCK = 12
const DURATION = 240

/** True if the touch started on something that owns horizontal gestures (carousels already scrolled, sliders, swipe rows…). */
function ownsHorizontalGesture(target: EventTarget | null) {
  let el = target instanceof Element ? target : null
  if (el?.closest("input, textarea, select, [role=slider], [data-swipe-ignore], [data-vaul-drawer]")) return true
  while (el && el !== document.body) {
    if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1 && el.scrollLeft > 0) {
      const overflow = getComputedStyle(el).overflowX
      if (overflow === "auto" || overflow === "scroll") return true
    }
    el = el.parentElement
  }
  return false
}

/**
 * Mobile profile panel (Spotify-style): swipe right from the left screen edge to open it; it follows the finger,
 * and closes by swiping left, tapping outside or pressing Escape. Desktop keeps the avatar menu in the top bar.
 */
export function ProfileDrawer() {
  const desktop = useMediaQuery("(min-width: 768px)")
  const router = useRouter()
  const mode = useSession((s) => s.mode)
  const creds = useSession((s) => s.creds)
  const logout = useSession((s) => s.logout)
  const profile = useProfile((s) => (s.status === "unavailable" ? null : s.user))
  const [themes, setThemes] = useState(false)
  const [password, setPassword] = useState(false)

  // open = mounted (Radix); offset = px the panel is pushed left of fully open (0 = open, width = hidden)
  const [open, setOpen] = useState(false)
  const [offset, setOffsetState] = useState(0)
  const offsetRef = useRef(0)
  const setOffset = useCallback((n: number) => { offsetRef.current = n; setOffsetState(n) }, [])
  const [dragging, setDragging] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const width = useRef(320)
  const openRef = useRef(false)
  openRef.current = open
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const settle = useCallback((toOpen: boolean) => {
    setDragging(false)
    if (closeTimer.current) clearTimeout(closeTimer.current)
    if (toOpen) {
      setOffset(0)
      return
    }
    setOffset(width.current)
    closeTimer.current = setTimeout(() => setOpen(false), DURATION)
  }, [setOffset])

  const close = useCallback(() => settle(false), [settle])

  // Opening by a programmatic tap is not offered on mobile; the gesture below is the only entry point.
  useEffect(() => {
    if (desktop) return
    type Track = { x: number; y: number; t: number; kind: "open" | "close"; locked: boolean }
    let track: Track | null = null
    let last = { dx: 0, t: 0, v: 0 }

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const touch = e.touches[0]
      if (openRef.current) {
        // closing swipe: only from inside the panel
        if (!panel.current?.contains(e.target as Node)) return
        if ((e.target as Element).closest?.("input, textarea, [role=slider], [data-swipe-ignore]")) return
        track = { x: touch.clientX, y: touch.clientY, t: e.timeStamp, kind: "close", locked: false }
      } else {
        if (touch.clientX > EDGE || window.innerWidth >= 768) return
        // never over "¿Quién escucha?" / the connecting screen: no profile panel without a session
        const { status, user } = useProfile.getState()
        if (status === "anon" || ((status === "checking" || status === "error") && !user)) return
        if (usePlayer.getState().fullOpen) return
        if (document.querySelector("[role=dialog][data-state=open], [data-vaul-drawer][data-state=open]")) return
        if (ownsHorizontalGesture(e.target)) return
        track = { x: touch.clientX, y: touch.clientY, t: e.timeStamp, kind: "open", locked: false }
      }
      last = { dx: 0, t: e.timeStamp, v: 0 }
    }

    const move = (e: TouchEvent) => {
      if (!track) return
      const touch = e.touches[0]
      const dx = touch.clientX - track.x
      const dy = touch.clientY - track.y
      if (!track.locked) {
        if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return
        const horizontal = Math.abs(dx) > Math.abs(dy) * 1.2 && (track.kind === "open" ? dx > 0 : dx < 0)
        if (!horizontal) { track = null; return }
        track.locked = true
        if (closeTimer.current) clearTimeout(closeTimer.current)
        if (track.kind === "open") {
          width.current = Math.min(320, window.innerWidth * 0.82)
          setOffset(width.current)
          setOpen(true)
        }
        setDragging(true)
      }
      // we own this gesture now: no page scroll, overscroll or browser back-swipe underneath the drag
      if (e.cancelable) e.preventDefault()
      const w = width.current
      const next = track.kind === "open" ? Math.min(w, Math.max(0, w - (dx - LOCK))) : Math.min(w, Math.max(0, -dx))
      setOffset(next)
      const dt = e.timeStamp - last.t
      if (dt > 0) last = { dx, t: e.timeStamp, v: (dx - last.dx) / dt }
    }

    const end = () => {
      if (!track) return
      const { kind, locked } = track
      track = null
      if (!locked) return
      const w = width.current
      const shown = w - offsetRef.current
      const fling = Math.abs(last.v) > 0.5
      settle(kind === "open" ? (fling ? last.v > 0 : shown > w * 0.35) : fling ? last.v > 0 : shown > w * 0.65)
    }

    document.addEventListener("touchstart", start, { passive: true })
    document.addEventListener("touchmove", move, { passive: false })
    document.addEventListener("touchend", end, { passive: true })
    document.addEventListener("touchcancel", end, { passive: true })
    return () => {
      document.removeEventListener("touchstart", start)
      document.removeEventListener("touchmove", move)
      document.removeEventListener("touchend", end)
      document.removeEventListener("touchcancel", end)
    }
  }, [desktop, settle, setOffset])

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  if (desktop) return null

  const sourceName = mode === "subsonic" ? creds?.username ?? "?" : mode === "ytdlp" ? "YouTube" : "Demo"
  const name = profile?.name ?? sourceName
  const subtitle = mode === "subsonic" ? creds?.username ?? "Navidrome" : mode === "ytdlp" ? "YouTube Music" : "Modo demo (datos de prueba)"
  const go = (href: string) => { close(); router.push(href) }
  const shown = Math.max(0, Math.min(1, 1 - offset / width.current))
  const transition = dragging ? "none" : `transform ${DURATION}ms cubic-bezier(0.32, 0.72, 0, 1), opacity ${DURATION}ms ease-out`

  return (
    <>
      <Sheet open={open} onOpenChange={(next) => (next ? settle(true) : close())}>
        <SheetPrimitive.Portal>
          <SheetPrimitive.Overlay
            data-slot="sheet-overlay"
            className="fixed inset-0 z-50 bg-black/40 md:hidden"
            style={{ opacity: shown, transition, animation: "none" }}
          />
          <SheetPrimitive.Content
            ref={panel}
            data-slot="sheet-content"
            data-side="left"
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="fixed inset-y-0 left-0 z-50 flex w-[min(82vw,320px)] flex-col glass-player pt-[max(var(--safe-top),12px)] pb-[max(env(safe-area-inset-bottom),12px)] text-sm text-popover-foreground shadow-2xl shadow-black/40 outline-none md:hidden"
            style={{ transform: `translateX(${-offset}px)`, transition, animation: "none", touchAction: "pan-y" }}
          >
            <div className="flex flex-col items-start gap-3 px-5 pt-5 pb-6">
              {profile ? (
                <ProfileAvatar name={profile.name} color={profile.color} className="size-16 text-2xl" />
              ) : (
                <Avatar className="size-16">
                  <AvatarFallback className="bg-primary text-2xl font-semibold text-primary-foreground">{name.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
              )}
              <div className="flex min-w-0 max-w-full flex-col">
                <SheetTitle className="truncate text-2xl font-bold tracking-tight">{name}</SheetTitle>
                <SheetDescription className={profile ? "sr-only" : "truncate text-[13px]"}>{subtitle}</SheetDescription>
              </div>
            </div>
            <nav className="flex flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-3" aria-label="Perfil">
              <GlassGroup>
                <GlassButtonRow icon={<History />} onClick={() => go("/history/")}>Historial</GlassButtonRow>
                <GlassButtonRow icon={<ArrowDownCircle />} onClick={() => go("/downloads/")}>Descargas</GlassButtonRow>
              </GlassGroup>
              <GlassGroup>
                <GlassButtonRow icon={<SlidersHorizontal />} onClick={() => { close(); useUi.setState({ settingsOpen: true }) }}>Reproducción</GlassButtonRow>
                <GlassButtonRow icon={<Palette />} onClick={() => { close(); setThemes(true) }}>Temas</GlassButtonRow>
                {profile && <GlassButtonRow icon={<KeyRound />} onClick={() => { close(); setPassword(true) }}>Cambiar contraseña</GlassButtonRow>}
              </GlassGroup>
              {/* Real role of the session (/api/auth/me); the server also answers 403 to /api/admin for other profiles. */}
              {profile?.role === "admin" && (
                <GlassGroup>
                  <GlassButtonRow icon={<Users />} onClick={() => go("/admin/")}>Administrar perfiles</GlassButtonRow>
                </GlassGroup>
              )}
            </nav>
            <div className="flex flex-col items-center gap-2 px-3 pt-3">
              {profile && (
                <button
                  type="button"
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white/[0.07] text-[15px] font-semibold text-red-400 outline-none transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-ring active:bg-white/[0.12] [&_svg]:size-[18px]"
                  onClick={() => {
                    close()
                    resetForProfile()
                    void useProfile.getState().logout()
                  }}
                >
                  <LogOut /> Cerrar sesión
                </button>
              )}
              {/* Without profiles (demo / plain Navidrome) this is the only way out; with a profile it is not offered. */}
              {!profile && !FIXED_SERVER && (
                <button
                  type="button"
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white/[0.07] text-[15px] font-semibold outline-none transition-colors hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-[18px]"
                  onClick={() => {
                    close()
                    usePlayer.setState({ isPlaying: false, queue: [], original: [], index: 0 })
                    clearDataCache()
                    logout()
                    router.replace("/login/")
                  }}
                >
                  {mode === "subsonic" ? <LogOut /> : <Server />}
                  {mode === "subsonic" ? "Cerrar sesión" : "Cambiar fuente de música"}
                </button>
              )}
              <p className="pt-1 text-[11px] text-muted-foreground/60">Decibel {APP_VERSION}</p>
            </div>
          </SheetPrimitive.Content>
        </SheetPrimitive.Portal>
      </Sheet>
      <ThemePicker open={themes} onOpenChange={setThemes} />
      {profile && <PasswordDialog open={password} onOpenChange={setPassword} />}
    </>
  )
}
