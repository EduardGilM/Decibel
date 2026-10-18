"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { getProvider } from "@/lib/providers"
import { useLikes, usePlayer } from "@/stores/player"
import { useUi } from "@/stores/ui"

/** Single source of truth for the help panel and the handler below. */
export const SHORTCUT_GROUPS: { title: string; items: [string[], string][] }[] = [
  { title: "Reproducción", items: [
    [["Espacio"], "Reproducir / pausar"],
    [["N"], "Siguiente canción"],
    [["P"], "Canción anterior"],
    [["→", "←"], "Avanzar / retroceder 5 s"],
    [["Shift", "→ / ←"], "Siguiente / anterior"],
    [["0 … 9"], "Saltar al 0 %–90 % de la canción"],
    [["S"], "Aleatorio"],
    [["R"], "Repetir (cola / canción / no)"],
  ] },
  { title: "Volumen", items: [
    [["↑", "↓"], "Subir / bajar volumen"],
    [["M"], "Silenciar"],
  ] },
  { title: "Biblioteca y vistas", items: [
    [["L"], "Me gusta en la canción actual"],
    [["Q"], "Abrir la cola"],
    [["Y"], "Mostrar / ocultar letra"],
    [["/", "Ctrl K"], "Buscar"],
    [["?"], "Esta ayuda"],
  ] },
]

async function toggleLikeCurrent() {
  const track = usePlayer.getState().current()
  if (!track) return
  const likes = useLikes.getState()
  const liked = likes.overrides[track.id] ?? !!track.starred
  likes.set(track.id, !liked)
  try {
    if (liked) await getProvider().unstar(track.id, "track")
    else await getProvider().star(track.id, "track")
    toast(liked ? `«${track.title}» eliminada de Me gusta` : `«${track.title}» añadida a Me gusta`)
  } catch (error) {
    likes.set(track.id, liked)
    toast.error((error as Error).message)
  }
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable=true], [role=slider], [role=menu], [role=listbox], [role=combobox]")

/** Global keyboard shortcuts (desktop + hardware keyboards on tablets). */
export function useKeyboardShortcuts() {
  const router = useRouter()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target)) return
      const p = usePlayer.getState()
      const a = p.audio
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey
      if ((key === "k" && (e.ctrlKey || e.metaKey)) || (key === "/" && plain)) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent("decibel:focus-search"))
        return
      }
      if (!plain && !(e.shiftKey && (key === "ArrowRight" || key === "ArrowLeft"))) return
      // Space on a focused button should press the button, not toggle playback twice.
      if (e.code === "Space" && e.target instanceof HTMLElement && e.target.closest("button, a, [role=button], [role=tab]")) return
      const duration = a?.duration && isFinite(a.duration) ? a.duration : p.duration
      switch (true) {
        case e.code === "Space": e.preventDefault(); p.toggle(); break
        case key === "ArrowRight" && e.shiftKey: e.preventDefault(); void p.next(); break
        case key === "ArrowLeft" && e.shiftKey: e.preventDefault(); p.prev(); break
        case key === "ArrowRight": if (a) { e.preventDefault(); p.seek(a.currentTime + 5) } break
        case key === "ArrowLeft": if (a) { e.preventDefault(); p.seek(a.currentTime - 5) } break
        case key === "ArrowUp": e.preventDefault(); p.setVolume(p.volume + 0.05); break
        case key === "ArrowDown": e.preventDefault(); p.setVolume(p.volume - 0.05); break
        case key === "n": void p.next(); break
        case key === "p": p.prev(); break
        case key === "m": p.toggleMute(); break
        case key === "s": p.toggleShuffle(); break
        case key === "r": p.cycleRepeat(); break
        case key === "l": void toggleLikeCurrent(); break
        case key === "q": router.push("/queue/"); break
        case key === "y": {
          if (window.matchMedia("(min-width: 1280px)").matches) { p.setPanelOpen(true); p.setLyricsOpen(!(p.panelOpen && p.lyricsOpen)) }
          else { p.setFullTab("lyrics"); p.setFullOpen(!(p.fullOpen && p.fullTab === "lyrics")) }
          break
        }
        case key === "?": useUi.setState({ shortcutsOpen: true }); break
        case /^[0-9]$/.test(key): if (duration > 0) p.seek((Number(key) / 10) * duration); break
        default: return
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [router])
}
