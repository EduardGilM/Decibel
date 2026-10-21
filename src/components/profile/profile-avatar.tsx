import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"
import { profileColor } from "@/lib/profile-color"

/** Initial on a disc tinted with --avatar-accent: the theme accent by default (follows the theme / cover tint live). */
export const AVATAR_FALLBACK = "[--avatar-accent:var(--primary)] bg-[color-mix(in_oklab,var(--avatar-accent)_26%,#141414)] text-[color-mix(in_oklab,var(--avatar-accent)_55%,white)]"

/**
 * Profiles without a photo. `own`: lists of several profiles (share dialog, admin, playlist members) tint each disc
 * with that profile's own colour; otherwise (your own badge) the theme accent decides.
 */
export function ProfileAvatar({ name, color, own = false, className }: { name: string; color?: string; own?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold", AVATAR_FALLBACK, className)}
      style={own ? { "--avatar-accent": profileColor(name, color) } as CSSProperties : undefined}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}
