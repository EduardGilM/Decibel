"use client"

import { useEffect, useRef, useState } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { create } from "zustand"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import styles from "./app-dialog.module.css"

/**
 * App-styled replacements for window.confirm / window.prompt (the WebView shows Android's native
 * English "CANCEL / OK" boxes). Imperative and promise-based: `if (!(await confirmDialog({...}))) return`.
 * One host (<AppDialogHost />, mounted once in the root layout) renders whichever request is open.
 */
interface Request {
  kind: "confirm" | "prompt"
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  /** prompt only */
  label?: string
  initial?: string
  placeholder?: string
  maxLength?: number
  resolve: (value: boolean | string | null) => void
}

const useDialogs = create<{ current?: Request; open: boolean }>()(() => ({ open: false }))

function ask(request: Omit<Request, "resolve">) {
  return new Promise<boolean | string | null>((resolve) => {
    useDialogs.getState().current?.resolve(request.kind === "confirm" ? false : null) // never leave a caller hanging
    useDialogs.setState({ current: { ...request, resolve }, open: true })
  })
}

export const confirmDialog = (options: Omit<Request, "kind" | "resolve" | "label" | "initial" | "placeholder" | "maxLength">) =>
  ask({ kind: "confirm", ...options }) as Promise<boolean>

export const promptDialog = (options: Omit<Request, "kind" | "resolve" | "destructive">) =>
  ask({ kind: "prompt", ...options }) as Promise<string | null>

export function AppDialogHost() {
  const { current, open } = useDialogs()
  const [value, setValue] = useState("")
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (current) setValue(current.initial ?? "") }, [current])

  const finish = (result: boolean | string | null) => {
    current?.resolve(result)
    useDialogs.setState({ open: false }) // keep `current` for the exit animation
  }
  const cancel = () => finish(current?.kind === "confirm" ? false : null)
  const accept = () => {
    if (current?.kind === "prompt") { const text = value.trim(); if (text) finish(text) }
    else finish(true)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) cancel() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn(styles.overlay, "fixed inset-0 z-[120] bg-black/55")} />
        <DialogPrimitive.Content
          className={cn(styles.panel, "fixed top-1/2 left-1/2 z-[120] w-[min(calc(100vw-2.5rem),22rem)] -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-6 text-popover-foreground outline-none")}
          onOpenAutoFocus={(event) => { if (current?.kind === "prompt") { event.preventDefault(); requestAnimationFrame(() => input.current?.select()) } }}
        >
          {current && (
            <form onSubmit={(event) => { event.preventDefault(); accept() }} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5 text-center">
                <DialogPrimitive.Title className="text-lg leading-snug font-semibold text-balance">{current.title}</DialogPrimitive.Title>
                {current.description ? (
                  <DialogPrimitive.Description className="text-sm text-muted-foreground text-balance">{current.description}</DialogPrimitive.Description>
                ) : <DialogPrimitive.Description className="sr-only">{current.title}</DialogPrimitive.Description>}
              </div>
              {current.kind === "prompt" && (
                <Input ref={input} aria-label={current.label ?? current.title} value={value} placeholder={current.placeholder} maxLength={current.maxLength ?? 80} onChange={(event) => setValue(event.target.value)} className="h-11" />
              )}
              <div className="mt-1 grid grid-cols-2 gap-2.5">
                <Button type="button" variant="secondary" className="h-11 rounded-full bg-white/10 text-[15px] hover:bg-white/15" onClick={cancel}>{current.cancelLabel ?? "Cancelar"}</Button>
                <Button
                  type="submit"
                  disabled={current.kind === "prompt" && !value.trim()}
                  className={cn("h-11 rounded-full text-[15px]", current.destructive && "bg-[oklch(0.62_0.21_25)] text-white hover:bg-[oklch(0.58_0.21_25)]")}
                >
                  {current.confirmLabel ?? (current.kind === "prompt" ? "Guardar" : "Aceptar")}
                </Button>
              </div>
            </form>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
