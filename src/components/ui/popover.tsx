"use client"

import * as React from "react"
import { cn } from "cn"
import { Popover as PopoverPrimitive } from "radix-ui"
import { GLASS_ARROW, GLASS_RADIUS, GlassShape, useGlassGeometry } from "./glass-shape"
import styles from "./popover.module.css"

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverContent({ className, align = "center", sideOffset = 4, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn("z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-lg bg-popover p-2 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { GLASS_ARROW, GLASS_RADIUS }

/**
 * Apple-style popover: translucent blurred panel whose arrow is part of the same shape (see GlassShape).
 * Radix still positions a hidden arrow, so collisions keep the tip pointing at the trigger.
 */
function PopoverGlassContent({ className, children, align = "center", sideOffset = 6, collisionPadding = 8, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const content = React.useRef<HTMLDivElement>(null)
  const arrow = React.useRef<SVGSVGElement>(null)
  const geo = useGlassGeometry(content, arrow)

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={content}
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        arrowPadding={GLASS_RADIUS + 4}
        className={cn(styles.glass, "z-50 w-72 text-popover-foreground outline-hidden", className)}
        {...props}
      >
        {/* Invisible: only tells us where Radix wants the tip after collision handling. */}
        <PopoverPrimitive.Arrow ref={arrow} width={GLASS_ARROW.width} height={GLASS_ARROW.height} style={{ visibility: "hidden" }} />
        <GlassShape geo={geo} />
        <div className={styles.body}>{children}</div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}

/** Class names for the same glass outside a popover: `panel` (rounded surface) and `footer` (frosted bar over scrolling rows). */
export const glass = { panel: styles.panel, footer: styles.footer } as const

export { Popover, PopoverAnchor, PopoverContent, PopoverGlassContent, PopoverTrigger }
