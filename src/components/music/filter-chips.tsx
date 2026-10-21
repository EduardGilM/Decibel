"use client"

import type { ReactNode } from "react"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

/** Shared pill styling, also reused by true tabs (full-screen player) so everything looks the same. */
export const chipClass =
  "rounded-full! border-0 bg-foreground/10 px-3.5 text-[13px] font-medium text-foreground shadow-none transition-all duration-200 hover:bg-foreground/20 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"

/** Horizontally scrollable pill filters (Spotify-style). No container box. */
/** `extra`: non-filter pills (links) appended to the same scrolling row, e.g. Inicio → Wrapped. */
export function FilterChips<T extends string>({ value, onChange, options, className, size = "md", extra }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string; size?: "sm" | "md"; extra?: ReactNode }) {
  return (
    <ScrollArea className={cn("min-w-0", className)}>
      <div className="flex w-max items-center gap-2">
      <ToggleGroup type="single" value={value} onValueChange={(v) => v && onChange(v as T)} aria-label="Filtrar" spacing={2} className="flex w-max gap-2 rounded-none">
        {options.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} className={cn(chipClass, size === "sm" ? "h-8" : "h-9 px-4")}>
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {extra}
      </div>
      <ScrollBar orientation="horizontal" className="hidden" />
    </ScrollArea>
  )
}
