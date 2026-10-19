"use client"

import { useState } from "react"
import { Check, Loader2, Monitor, Smartphone, Speaker, Tablet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useDevices } from "@/stores/devices"
import { cn } from "@/lib/utils"
import { VolumeControl } from "./controls"

export function DevicePicker({ variant = "icon" }: { variant?: "icon" | "label" | "nav" }) {
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const state = useDevices()
  if (!state.enabled) return null
  const active = state.devices.find((device) => device.id === state.activeId)
  const remote = !!active && active.id !== state.deviceId
  const pending = sending || !!state.pendingId
  const label = pending ? "Cambiando…" : active ? remote ? active.name : "Este dispositivo" : "Elegir dispositivo"
  const alone = state.devices.length < 2
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size={variant === "icon" ? "icon" : "default"}
          aria-label={`Dispositivos · ${label}`}
          title={label}
          className={cn(
            variant === "nav" ? "h-14 flex-col gap-1 rounded-lg text-[11px] font-medium hover:bg-transparent" : "rounded-full",
            variant === "label" && "max-w-full text-xs",
            active ? "text-primary" : "text-muted-foreground",
          )}
        >
          {pending ? <Loader2 className="size-5 animate-spin" /> : <Speaker className={variant === "nav" ? "size-6!" : "size-5"} />}
          {variant !== "icon" && <span className="truncate">{variant === "nav" ? "Dispositivos" : label}</span>}
        </Button>
      </DialogTrigger>
      <DialogContent className="z-[110] max-h-[90dvh] overflow-y-auto rounded-3xl p-6">
        <DialogHeader>
          <DialogTitle>Dispositivos</DialogTitle>
          {/* Only a hint while this is the only device. */}
          <DialogDescription className={alone ? undefined : "sr-only"}>Abre Decibel en otro dispositivo para verlo aquí.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[45dvh] space-y-2 overflow-y-auto" aria-label="Dispositivos disponibles">
          {state.devices.map((device) => {
            const selected = device.id === state.activeId
            const waiting = device.id === state.pendingId
            const Icon = device.kind === "phone" ? Smartphone : device.kind === "tablet" ? Tablet : Monitor
            return (
              <button
                key={device.id}
                type="button"
                aria-pressed={selected}
                disabled={!state.connected || pending || selected}
                className={cn("flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default", selected ? "bg-primary/10 text-primary" : "bg-muted/40")}
                onClick={async () => {
                  setSending(true)
                  try { await state.transfer?.(device.id) } finally { setSending(false) }
                }}
              >
                <Icon className="size-6 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{device.name}</span>
                  {(waiting || device.id === state.deviceId) && <span className="block text-xs text-muted-foreground">{waiting ? "Conectando…" : "Este dispositivo"}</span>}
                </span>
                {waiting ? <Loader2 className="size-4 animate-spin" /> : selected ? <Check className="size-4" /> : null}
              </button>
            )
          })}
          {!state.devices.length && <p className="py-4 text-sm text-muted-foreground">Buscando…</p>}
        </div>
        {remote && state.connected && !pending && (
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-sm text-muted-foreground">Volumen</span>
            <VolumeControl />
          </div>
        )}
        {state.error && <p role="status" className="text-sm text-destructive">{state.error}</p>}
      </DialogContent>
    </Dialog>
  )
}
