import { cn } from "@/lib/utils"

/** Initial on a muted disc; the profile colour only tints it slightly. */
export function ProfileAvatar({ name, color, className }: { name: string; color?: string; className?: string }) {
  const tint = color ?? "#9ca3af"
  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white/90", className)}
      style={{ background: `linear-gradient(145deg, color-mix(in oklab, ${tint} 38%, #2a2a2a), color-mix(in oklab, ${tint} 14%, #181818))` }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}
