"use client"

import { confirmDialog } from "@/components/ui/app-dialog"
import { ArrowDown, Check, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { canDownload, download, offlineKey, removeDownloads, useOffline } from "@/lib/offline/downloads"
import { getProvider, useProvider } from "@/lib/providers"
import type { Track } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Download / remove a whole album or list for offline listening. Hidden for YouTube. */
export function DownloadButton({ tracks, className }: { tracks?: Track[]; className?: string }) {
  const provider = useProvider()
  const source = provider.kind
  const keys = (tracks ?? []).filter((t) => canDownload(source, t)).map((t) => offlineKey(source, t.id))
  const saved = useOffline((s) => keys.filter((k) => s.items[k]).length)
  const busy = useOffline((s) => keys.filter((k) => s.pending[k]).length)
  if (!canDownload(source) || !keys.length) return null
  const done = saved === keys.length

  async function onClick() {
    if (busy) return
    if (done) {
      if (await confirmDialog({ title: "¿Quitar la descarga?", description: "Tendrás que estar conectado para escucharla.", confirmLabel: "Quitar", destructive: true })) await removeDownloads(keys)
      return
    }
    try {
      const { ok, failed } = await download(tracks ?? [], getProvider())
      if (failed.length) toast.error(failed[0], { description: failed.length > 1 ? `y ${failed.length - 1} más` : undefined })
      else if (ok) toast("Descargado para escuchar sin conexión")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-lg"
      onClick={onClick}
      aria-label={done ? "Quitar descarga" : busy ? `Descargando ${saved} de ${keys.length}` : "Descargar"}
      title={done ? "Descargado" : busy ? `Descargando ${saved}/${keys.length}` : "Descargar para escuchar sin conexión"}
      className={cn("relative rounded-full text-muted-foreground", done && "text-foreground", className)}
    >
      {busy ? (
        <Loader2 className="animate-spin" />
      ) : (
        <span className={cn("flex size-6 items-center justify-center rounded-full border-2", done ? "border-foreground bg-foreground text-background" : "border-current")}>
          {done ? <Check className="size-3.5" strokeWidth={3} /> : <ArrowDown className="size-3.5" strokeWidth={2.5} />}
        </span>
      )}
    </Button>
  )
}
