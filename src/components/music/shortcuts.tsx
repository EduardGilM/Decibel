"use client"

import { Fragment } from "react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Kbd } from "@/components/ui/kbd"
import { SHORTCUT_GROUPS } from "./keyboard-shortcuts"

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Atajos de teclado</SheetTitle>
          <SheetDescription>Funcionan en cualquier vista salvo al escribir. Pulsa ? para abrir esta ayuda.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-6">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="flex flex-col gap-1">
              <h3 className="pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group.title}</h3>
              {group.items.map(([keys, label]) => (
                <div key={label} className="flex items-center justify-between gap-3 rounded-md py-2 text-sm">
                  <span>{label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {keys.map((k, i) => (
                      <Fragment key={k}>
                        {i > 0 && <span className="text-xs text-muted-foreground">{keys.length === 2 && k.includes("/") ? "+" : "/"}</span>}
                        <Kbd className="h-6 px-2.5 text-xs text-foreground/85">{k}</Kbd>
                      </Fragment>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
          <p className="text-xs text-muted-foreground">Auriculares, teclas multimedia y pantalla de bloqueo controlan la reproducción mediante Media Session (play/pausa, siguiente, anterior, saltos y barra de progreso).</p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
