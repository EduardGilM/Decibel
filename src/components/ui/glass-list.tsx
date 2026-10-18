"use client"

import { ChevronRight } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/** Rounded translucent card grouping rows (iOS-settings / Spotify style); hairline separators inset past the icon. */
export function GlassGroup({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div className={cn("flex flex-col", className)}>
      {label && <div className="px-4 pb-1.5 text-[12px] font-medium tracking-wide text-muted-foreground uppercase">{label}</div>}
      <div className="overflow-hidden rounded-2xl bg-white/[0.07] [&>*+*]:shadow-[inset_0_0.5px_0_0_rgb(255_255_255/0.08)]">{children}</div>
    </div>
  )
}

const rowClass = "flex min-h-[52px] w-full items-center gap-3.5 px-4 text-left text-[15px] font-medium text-foreground outline-none transition-colors duration-150 [&_svg]:shrink-0"

/** Tappable row: icon, label, optional trailing value, chevron. */
export function GlassButtonRow({ icon, children, value, onClick, chevron = true, destructive = false }: { icon?: ReactNode; children: ReactNode; value?: ReactNode; onClick: () => void; chevron?: boolean; destructive?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn(rowClass, "hover:bg-white/[0.05] focus-visible:bg-white/[0.08] active:bg-white/[0.1]", destructive && "text-red-400")}>
      {icon && <span className={cn("flex size-5 items-center justify-center [&_svg]:size-[20px] [&_svg]:stroke-[1.75]", destructive ? "text-red-400" : "text-foreground/80")}>{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {value != null && <span className="shrink-0 text-sm text-muted-foreground">{value}</span>}
      {chevron && <ChevronRight className="size-4 text-muted-foreground/70" aria-hidden />}
    </button>
  )
}

/** Static row with a control on the right (switch, value). */
export function GlassRow({ icon, label, htmlFor, children, className }: { icon?: ReactNode; label: ReactNode; htmlFor?: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn(rowClass, className)}>
      {icon && <span className="flex size-5 items-center justify-center text-foreground/80 [&_svg]:size-[20px] [&_svg]:stroke-[1.75]">{icon}</span>}
      <label htmlFor={htmlFor} className="min-w-0 flex-1 truncate">{label}</label>
      {children}
    </div>
  )
}
