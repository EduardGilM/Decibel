"use client"

import { useEffect } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Button } from "@/components/ui/button"
import styles from "@/components/ui/app-dialog.module.css"
import { cn } from "@/lib/utils"
import { openDownloads, startUpdateChecks, useAppUpdate } from "@/stores/app-update"

const secondary = "h-11 rounded-full bg-white/10 text-[15px] hover:bg-white/15"

/**
 * «Actualización disponible» (native apps only): same look as the app's confirm dialogs. «Actualizar» updates
 * in place with a progress bar; the download page is only offered as a fallback after an error.
 */
export function UpdateDialog() {
  const offer = useAppUpdate((s) => s.offer)
  const open = useAppUpdate((s) => s.open)
  const phase = useAppUpdate((s) => s.phase)
  const progress = useAppUpdate((s) => s.progress)
  const error = useAppUpdate((s) => s.error)
  useEffect(() => startUpdateChecks(), [])
  if (!offer) return null
  const busy = phase === "downloading" || phase === "installing" || phase === "permission"
  const percent = progress === null ? null : Math.round(progress * 100)
  const status =
    phase === "installing" ? (offer.kind === "android" ? "Abriendo el instalador…" : "Instalando… Decibel se reiniciará")
    : phase === "permission" ? "Permite «Instalar apps desconocidas» para Decibel y vuelve a la app."
    : phase === "downloading" ? `Descargando${percent === null ? "…" : ` ${percent} %`}`
    : phase === "error" ? `No se pudo actualizar${error ? `: ${error}` : "."}`
    : `Decibel ${offer.version}`
  const update = useAppUpdate.getState
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) update().later() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn(styles.overlay, "fixed inset-0 z-[120] bg-black/55")} />
        <DialogPrimitive.Content
          className={cn(styles.panel, "fixed top-1/2 left-1/2 z-[120] w-[min(calc(100vw-2.5rem),22rem)] -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-6 text-popover-foreground outline-none")}
          onInteractOutside={(event) => { if (busy) event.preventDefault() }}
          onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5 text-center">
              <DialogPrimitive.Title className="text-lg leading-snug font-semibold text-balance">Actualización disponible</DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm text-pretty text-muted-foreground tabular-nums" aria-live="polite">{status}</DialogPrimitive.Description>
            </div>
            {phase === "downloading" || phase === "installing" ? (
              <div className="mt-1 h-11 content-center" role="progressbar" aria-label="Progreso de la actualización" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className={cn("h-full rounded-full bg-primary transition-[width] duration-300", percent === null && "w-1/3 animate-pulse")} style={percent === null ? undefined : { width: `${percent}%` }} />
                </div>
              </div>
            ) : phase === "permission" ? (
              <div className="mt-1 grid grid-cols-2 gap-2.5">
                <Button type="button" variant="secondary" className={secondary} onClick={() => update().cancel()}>Cancelar</Button>
                <Button type="button" className="h-11 rounded-full text-[15px]" onClick={() => update().resume()}>Continuar</Button>
              </div>
            ) : (
              <div className="mt-1 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2.5">
                  <Button type="button" variant="secondary" className={secondary} onClick={() => update().later()}>Más tarde</Button>
                  <Button type="button" className="h-11 rounded-full text-[15px]" onClick={() => void update().start()}>{phase === "error" ? "Reintentar" : "Actualizar"}</Button>
                </div>
                {phase === "error" && (
                  <button type="button" className="text-center text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={openDownloads}>Descargar desde la web</button>
                )}
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
