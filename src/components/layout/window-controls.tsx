"use client"

import { useEffect, useState } from "react"
import { isDesktopApp } from "@/stores/app-update"
import { cn } from "@/lib/utils"

type AppWindow = { minimize(): Promise<void>; toggleMaximize(): Promise<void>; close(): Promise<void>; isMaximized(): Promise<boolean>; onResized(handler: () => void): Promise<() => void> }

/** True inside the desktop app (Windows/Linux), where the app draws its own title bar. */
export function useDesktopApp() {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => setDesktop(isDesktopApp()), [])
  return desktop
}

const button = "grid h-full w-[46px] place-items-center text-foreground/80 outline-none transition-colors hover:bg-white/10 hover:text-foreground focus-visible:bg-white/10"

/** Windows 11 style caption buttons in the app's theme (the native title bar is off: `decorations: false`). */
export function WindowControls({ className }: { className?: string }) {
  const [win, setWin] = useState<AppWindow | null>(null)
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    if (!isDesktopApp()) return
    let unlisten: (() => void) | undefined
    let alive = true
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const current = getCurrentWindow() as unknown as AppWindow
      if (!alive) return
      setWin(current)
      const sync = () => void current.isMaximized().then(setMaximized).catch(() => {})
      sync()
      unlisten = await current.onResized(sync)
    }).catch(() => {})
    return () => { alive = false; unlisten?.() }
  }, [])
  if (!win) return null
  return (
    <div className={cn("flex h-10 shrink-0 self-start", className)} data-tauri-drag-region="false">
      <button type="button" aria-label="Minimizar" className={button} onClick={() => void win.minimize()}>
        <svg aria-hidden viewBox="0 0 10 10" className="size-2.5"><path d="M0 5h10" stroke="currentColor" strokeWidth="1" /></svg>
      </button>
      <button type="button" aria-label={maximized ? "Restaurar" : "Maximizar"} className={button} onClick={() => void win.toggleMaximize()}>
        {maximized ? (
          <svg aria-hidden viewBox="0 0 10 10" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="2.5" width="7" height="7" rx="1" /><path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" /></svg>
        ) : (
          <svg aria-hidden viewBox="0 0 10 10" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9" rx="1.5" /></svg>
        )}
      </button>
      <button type="button" aria-label="Cerrar" className={cn(button, !maximized && "rounded-tr-lg", "hover:bg-[#c42b1c] hover:text-white focus-visible:bg-[#c42b1c] focus-visible:text-white")} onClick={() => void win.close()}>
        <svg aria-hidden viewBox="0 0 10 10" className="size-2.5" stroke="currentColor" strokeWidth="1"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" /></svg>
      </button>
    </div>
  )
}
