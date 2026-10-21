"use client"

import { confirmDialog } from "@/components/ui/app-dialog"
import { ArrowDownCircle, Trash2, X } from "lucide-react"
import { useSyncExternalStore } from "react"
import { toast } from "sonner"
import { TopBar } from "@/components/music/top-bar"
import { TrackList } from "@/components/music/track-list"
import { PlayButton } from "@/components/music/play-button"
import { Button } from "@/components/ui/button"
import { formatBytes, offlineKey, removeDownloads, useOffline, usedBytes } from "@/lib/offline/downloads"
import { useOfflineScope } from "@/lib/offline/context"

const subscribe = () => () => {}
const useMounted = () => useSyncExternalStore(subscribe, () => true, () => false)

async function remove(keys: string[]) {
  try { await removeDownloads(keys) } catch { toast.error("No se pudo borrar la descarga. Vuelve a intentarlo.") }
}

export default function DownloadsPage() {
  const mounted = useMounted()
  const scope = useOfflineScope()
  const all = useOffline((s) => s.items)
  const pending = useOffline((s) => s.pending)
  const limitMB = useOffline((s) => s.limitMB)
  const items = mounted ? Object.values(all).filter((i) => i.scope === scope).sort((a, b) => b.savedAt - a.savedAt) : []
  const keys = Object.keys(pending).filter((key) => { try { return JSON.parse(key)[1] === scope } catch { return false } })
  const legacy = mounted ? Object.entries(all).filter(([, item]) => !item.scope).map(([key]) => key) : []
  const used = usedBytes(all), limit = limitMB * 1024 * 1024
  const tracks = items.map((i) => i.track)
  return (
    <div>
      <TopBar title="Descargadas" />
      <div className="flex flex-col gap-6 px-2 pt-2 pb-8 md:px-4">
        <div className="flex flex-col gap-3 px-2">
          <h1 className="hidden text-3xl font-bold tracking-tight md:block">Descargadas</h1>
          {mounted && <div className="flex max-w-md flex-col gap-1.5">
            <div role="meter" aria-label="Almacenamiento de descargas" aria-valuenow={used} aria-valuemin={0} aria-valuemax={Math.max(used, limit)} className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-foreground/80" style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">{formatBytes(used)} / {formatBytes(limit)}</p>
          </div>}
          {legacy.length > 0 && <div><button type="button" className="text-xs text-muted-foreground underline" onClick={async () => {
            if (await confirmDialog({ title: "¿Borrar las descargas anteriores?", description: "Se liberará su espacio en este dispositivo.", confirmLabel: "Borrar", destructive: true })) await remove(legacy)
          }}>Borrar descargas anteriores</button></div>}
          {keys.length > 0 && <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <ArrowDownCircle aria-hidden="true" className="size-4 animate-pulse" /> {keys.length}
            <span className="sr-only">{keys.length === 1 ? "canción descargándose" : "canciones descargándose"}</span>
            <Button variant="ghost" size="icon" aria-label="Cancelar descargas" title="Cancelar descargas" onClick={() => void remove(keys)}><X /></Button>
          </div>}
        </div>
        {mounted && items.length === 0 && <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <ArrowDownCircle aria-hidden="true" className="size-8" /><p className="text-sm">Sin descargas</p>
        </div>}
        {items.length > 0 && <section className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2 px-2">
            <div className="flex items-center gap-3"><PlayButton tracks={tracks} label="downloads" /><h2 className="text-sm text-muted-foreground">{items.length} {items.length === 1 ? "canción" : "canciones"}</h2></div>
            <Button variant="ghost" size="icon" aria-label="Borrar descargas" title="Borrar descargas" className="rounded-full text-muted-foreground" onClick={async () => {
              if (await confirmDialog({ title: "¿Borrar descargas?", description: "Se borrarán de este dispositivo.", confirmLabel: "Borrar", destructive: true })) await remove([...keys, ...items.map((i) => offlineKey(i.source, i.track.id, scope))])
            }}><Trash2 /></Button>
          </div>
          <TrackList tracks={tracks} label="downloads" numbered={false} subline={(t) => <span className="text-muted-foreground/70"> · {formatBytes(all[offlineKey(items[0].source, t.id, scope)]?.size ?? 0)}</span>} />
        </section>}
      </div>
    </div>
  )
}
