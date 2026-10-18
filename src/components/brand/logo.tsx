import { cn } from "@/lib/utils"

/** Symmetrical Decibel waveform generated with imagegen, without a wordmark. */
export function DecibelMark({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-block size-8 shrink-0 bg-primary [mask-image:url('/brand/decibel-mark-symmetric.png')] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]", className)} />
  )
}

export function DecibelLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <DecibelMark className="size-10" />
      <span className="text-xl leading-none font-semibold tracking-tight text-foreground">Decibel</span>
    </span>
  )
}
