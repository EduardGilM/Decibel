import * as React from "react"
import { cn } from "@/lib/utils"

/** Keyboard hint pill used across the app ("Ctrl K", "Enter", shortcuts sheet). */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn("pointer-events-none inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-full bg-white/[0.09] px-2 font-sans text-[11px] leading-none font-medium text-muted-foreground select-none", className)}
      {...props}
    />
  )
}

export { Kbd }
