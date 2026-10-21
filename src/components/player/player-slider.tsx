"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

type PlayerSliderProps = Omit<React.ComponentProps<typeof SliderPrimitive.Root>, "aria-label"> & {
  label: string
  valueText?: string
  /** "bar": thin, thumb on hover/drag/focus. "full": mobile full player, thicker with thumb always visible. */
  variant?: "bar" | "full"
}

/**
 * Spotify-style slider for playback surfaces. Neutral white on any cover tint:
 * white/30 track over a faint dark underlay, solid white range (accent only while hovered/dragged).
 * Tall invisible hit area; arrow keys / Home / End via Radix.
 */
export function PlayerSlider({ label, valueText, variant = "bar", className, ...props }: PlayerSliderProps) {
  const full = variant === "full"
  return (
    <SliderPrimitive.Root
      data-slot="player-slider"
      // Inside the full-screen vaul drawer a drag on the slider would also start dragging the drawer.
      data-vaul-no-drag=""
      className={cn("group/slider relative flex w-full cursor-pointer touch-none items-center select-none data-disabled:cursor-default data-disabled:opacity-50", full ? "h-8" : "h-5", className)}
      {...props}
    >
      <SliderPrimitive.Track
        className={cn(
          "relative w-full grow overflow-hidden rounded-full bg-white/30 shadow-[0_0_0_0.5px_rgb(0_0_0/0.18)] transition-[height] duration-150",
          full ? "h-1.5" : "h-1 group-hover/slider:h-1.5 group-has-focus-visible/slider:h-1.5",
        )}
      >
        <SliderPrimitive.Range
          className={cn(
            "absolute h-full rounded-full bg-white transition-colors duration-150",
            !full && "group-hover/slider:bg-primary group-active/slider:bg-primary",
          )}
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={label}
        aria-valuetext={valueText}
        className={cn(
          "block rounded-full bg-white shadow-[0_1px_4px_rgb(0_0_0/0.45)] transition-all duration-200 ease-out outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40",
          full ? "size-3.5" : "size-3 scale-0 group-hover/slider:scale-110 group-active/slider:scale-125 focus-visible:scale-110",
        )}
      />
    </SliderPrimitive.Root>
  )
}
