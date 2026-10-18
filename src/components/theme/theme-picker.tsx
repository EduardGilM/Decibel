"use client"

import { Check, Play, Sparkles } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useIsMobile } from "@/hooks/use-mobile"
import { DYNAMIC_ID, dynamicAccent, setTheme, THEMES } from "@/lib/themes"
import { useNowPlayingTint } from "@/lib/use-tint"
import { cn } from "@/lib/utils"
import { useThemeId } from "./theme-controller"

function Swatch({ id, name, primary, foreground, active, icon, className, style }: { id: string; name: string; primary: string; foreground: string; active: boolean; icon?: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setTheme(id)}
      style={style}
      className={cn(
        "flex min-h-24 flex-col gap-3 rounded-2xl bg-white/[0.07] p-3 text-left outline-none transition-colors duration-150 hover:bg-white/[0.1] focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-white/[0.12] ring-2 ring-foreground/50 ring-inset",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-7 items-center rounded-full px-3 text-xs font-medium" style={{ backgroundColor: primary, color: foreground }}>
          Todo
        </span>
        <span className="flex size-8 items-center justify-center rounded-full" style={{ backgroundColor: primary, color: foreground }}>
          <Play className="ml-0.5 size-4 fill-current" />
        </span>
        <span className="ml-auto flex size-6 items-center justify-center">{active && <Check className="size-5" aria-hidden />}</span>
      </div>
      <div className="flex items-center gap-1.5 text-sm font-medium">
        {icon}
        {name}
      </div>
    </button>
  )
}

function Grid() {
  const active = useThemeId()
  const tint = useNowPlayingTint("dominant")
  const dyn = dynamicAccent(tint)
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {THEMES.map((t) => (
        <Swatch key={t.id} {...t} active={active === t.id} />
      ))}
      {/* Last card spans the whole row on phones (2 columns); with 3 columns it already fills the last slot. */}
      <Swatch
        id={DYNAMIC_ID}
        name="Dinámico"
        primary={dyn.primary}
        foreground={dyn.foreground}
        active={active === DYNAMIC_ID}
        icon={<Sparkles className="size-4" />}
        className="col-span-2 sm:col-span-1"
        style={{ backgroundImage: dynamicGradient(tint ?? dyn.primary) }}
      />
    </div>
  )
}

/** Subtle wash of the current cover colour, fading out to the right, over the usual card fill. */
const dynamicGradient = (color: string) =>
  `linear-gradient(105deg, color-mix(in oklab, ${color} 34%, transparent) 0%, color-mix(in oklab, ${color} 14%, transparent) 55%, transparent 100%)`

/** Screen readers still get what «Dinámico» means; on screen only the title is shown. */
const DESC = "Elige el color de acento. «Dinámico» usa el color de la portada que está sonando."

export function ThemePicker({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const isMobile = useIsMobile()
  if (isMobile)
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="glass-player bg-[color-mix(in_oklab,var(--card)_62%,transparent)] border-0 data-[vaul-drawer-direction=bottom]:border-t-0 pb-[max(env(safe-area-inset-bottom),16px)]">
          <DrawerHeader className="text-left">
            <DrawerTitle>Temas</DrawerTitle>
            <DrawerDescription className="sr-only">{DESC}</DrawerDescription>
          </DrawerHeader>
          <ScrollArea className="max-h-[60vh] px-4">
            <Grid />
          </ScrollArea>
        </DrawerContent>
      </Drawer>
    )
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-player bg-[color-mix(in_oklab,var(--card)_62%,transparent)] border-0 ring-0 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Temas</DialogTitle>
          <DialogDescription className="sr-only">{DESC}</DialogDescription>
        </DialogHeader>
        <Grid />
      </DialogContent>
    </Dialog>
  )
}
