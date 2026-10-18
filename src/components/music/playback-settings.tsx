"use client"

import { useSyncExternalStore } from "react"
import { AudioWaveform, Bell, Blend, HardDriveDownload, Infinity as Gapless } from "lucide-react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { GlassGroup, GlassRow } from "@/components/ui/glass-list"
import { isIOS } from "@/lib/audio/transition"
import { useSettings } from "@/stores/settings"
import { formatBytes, LIMIT_OPTIONS_MB, useOffline, usedBytes } from "@/lib/offline/downloads"
import { useSession } from "@/stores/session"
import { cn } from "@/lib/utils"
import { NotificationSettingRow } from "./native-media-bridge"

const subscribe = () => () => {}
const useIsIOS = () => useSyncExternalStore(subscribe, () => isIOS(navigator), () => false)

const CROSSFADES = [0, 3, 6, 10] as const

function Pills<T extends string | number>({ value, options, onChange, label, format }: { value: T; options: readonly T[]; onChange: (v: T) => void; label: string; format: (v: T) => string }) {
  return (
    <div className="flex flex-wrap gap-1.5 px-4 pb-3.5" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn("h-8 rounded-full px-3.5 text-[13px] font-medium transition-colors", value === option ? "bg-foreground text-background" : "bg-white/[0.08] text-foreground/80 hover:bg-white/[0.12]")}
        >
          {format(option)}
        </button>
      ))}
    </div>
  )
}

/**
 * "Reproducción": short, everything sensible already on (normalisation, gapless; the next songs are always
 * prepared in advance). Crossfade is off by default because it would overlap songs that gapless joins.
 */
export function PlaybackSettings({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { crossfade, gapless, normalize, setCrossfade, setGapless, setNormalize } = useSettings()
  const ios = useIsIOS()
  const youtube = useSession((s) => s.mode === "ytdlp")
  const limitMB = useOffline((s) => s.limitMB)
  const setLimit = useOffline((s) => s.setLimit)
  const used = useOffline((s) => usedBytes(s.items))
  const fade = CROSSFADES.includes(crossfade as (typeof CROSSFADES)[number]) ? crossfade : CROSSFADES.reduce((a, b) => (Math.abs(b - crossfade) < Math.abs(a - crossfade) ? b : a))
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="glass-player bg-[color-mix(in_oklab,var(--card)_62%,transparent)] overflow-y-auto border-0 data-[side=right]:border-l-0">
        <SheetHeader className="pt-5">
          <SheetTitle className="text-xl font-bold">Reproducción</SheetTitle>
          <SheetDescription className="sr-only">Ajustes de reproducción</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-3 pb-8">
          <GlassGroup>
            <GlassRow icon={<AudioWaveform />} label="Normalizar volumen" htmlFor="normalize">
              <Switch id="normalize" checked={normalize && !ios} disabled={ios} onCheckedChange={setNormalize} />
            </GlassRow>
            <GlassRow icon={<Gapless />} label="Sin pausas entre canciones" htmlFor="gapless">
              <Switch id="gapless" checked={gapless && !ios} disabled={ios} onCheckedChange={setGapless} />
            </GlassRow>
            {!ios && (
              <div>
                <GlassRow icon={<Blend />} label="Fundido" />
                <Pills label="Segundos de fundido" value={fade} options={CROSSFADES} onChange={setCrossfade} format={(v) => (v ? `${v} s` : "No")} />
              </div>
            )}
          </GlassGroup>
          {!youtube && (
            <GlassGroup>
              <div>
                <GlassRow icon={<HardDriveDownload />} label="Espacio para descargas">
                  <span className="text-sm text-muted-foreground tabular-nums">{formatBytes(used)}</span>
                </GlassRow>
                <Pills label="Límite de descargas" value={limitMB} options={LIMIT_OPTIONS_MB} onChange={setLimit} format={(mb) => formatBytes(mb * 1024 * 1024)} />
              </div>
            </GlassGroup>
          )}
          <NotificationSettingRow icon={<Bell />} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
