"use client"

import { ArrowDown } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAppUpdate } from "@/stores/app-update"
import { cn } from "@/lib/utils"

const R = 18
const C = 2 * Math.PI * R

/** Desktop app bar: round download button next to the avatar while an update is available (progress ring while downloading). */
export function UpdateButton() {
  const offer = useAppUpdate((s) => s.offer)
  const phase = useAppUpdate((s) => s.phase)
  const progress = useAppUpdate((s) => s.progress)
  if (offer?.kind !== "desktop") return null
  const busy = phase === "downloading" || phase === "installing" || phase === "permission"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={`Actualización disponible: Decibel ${offer.version}`} onClick={() => useAppUpdate.getState().show()}
          className="relative grid size-10 shrink-0 place-items-center rounded-full text-primary outline-none hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-ring">
          <svg aria-hidden viewBox="0 0 40 40" className="absolute inset-0 size-10 -rotate-90">
            <circle cx="20" cy="20" r={R} fill="none" stroke="currentColor" strokeOpacity={busy ? 0.18 : 0} strokeWidth="2" />
            {busy && <circle cx="20" cy="20" r={R} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={C}
              strokeDashoffset={C * (1 - (progress ?? 0.08))} className={cn("transition-[stroke-dashoffset] duration-300", progress === null && "animate-pulse")} />}
          </svg>
          <span className="grid size-8 place-items-center rounded-full bg-primary/15"><ArrowDown className="size-[18px]" strokeWidth={2.5} /></span>
          {!busy && <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-primary motion-safe:animate-ping [animation-duration:2.4s]" />}
          {!busy && <span aria-hidden className="absolute top-1 right-1 size-2 rounded-full bg-primary" />}
        </button>
      </TooltipTrigger>
      <TooltipContent>Actualización disponible</TooltipContent>
    </Tooltip>
  )
}
