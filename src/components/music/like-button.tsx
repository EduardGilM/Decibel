"use client"

import { Heart } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { getProvider } from "@/lib/providers"
import { cn } from "@/lib/utils"
import { useLikes } from "@/stores/player"

export function useLiked(id: string | undefined, initial?: boolean) {
  const override = useLikes((s) => (id ? s.overrides[id] : undefined))
  return override ?? !!initial
}

export function LikeButton({ id, type = "track", initial, className, size = "icon" }: { id: string; type?: "track" | "album" | "artist"; initial?: boolean; className?: string; size?: "icon" | "icon-lg" | "icon-sm" }) {
  const liked = useLiked(id, initial)
  const set = useLikes((s) => s.set)
  return (
    <Button
      variant="ghost"
      size={size}
      aria-pressed={liked}
      aria-label={liked ? "Quitar de Me gusta" : "Añadir a Me gusta"}
      className={cn(liked ? "text-primary" : "text-muted-foreground", className)}
      onClick={async (e) => {
        e.stopPropagation()
        set(id, !liked)
        try {
          if (liked) await getProvider().unstar(id, type)
          else await getProvider().star(id, type)
          toast(liked ? "Eliminado de Me gusta" : "Añadido a Me gusta")
        } catch (err) {
          set(id, liked)
          toast.error((err as Error).message)
        }
      }}
    >
      <Heart className={cn(liked && "fill-current")} />
    </Button>
  )
}
