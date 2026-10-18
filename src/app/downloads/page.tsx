"use client"

import { confirmDialog } from "@/components/ui/app-dialog"
import { ArrowDownCircle, Trash2 } from "lucide-react"
import { useSyncExternalStore } from "react"
import { TopBar } from "@/components/music/top-bar"
import { TrackList } from "@/components/music/track-list"
import { Button } from "@/components/ui/button"
import { canDownload, formatBytes, offlineKey, removeDownloads, useOffline, usedBytes } from "@/lib/offline/downloads"
import { useSession } from "@/stores/session"

const subscribe = () => () => {}
const useMounted = () => useSyncExternalStore(subscribe, () => true, () => false)

export default function DownloadsPage() {
  const mounted = useMounted()
  const mode = useSession((s) => s.mode)
  const all = useOffline((s) => s.items)
  const limitMB = useOffline((s) => s.limitMB)
  const items = mounted ? Object.values(all).filter((i) => i.source === mode).sort((a, b) => b.savedAt - a.savedAt) : []
  const used = usedBytes(all)
  const limit = limitMB * 1024 * 1024
  return (
    <div>
      <TopBar title="Descargas" />
      <div className="flex flex-col gap-6 px-2 pt-2 pb-8 md:px-4">
        <div className="flex flex-col gap-3 px-2">
          <h1 className="hidden text-3xl font-bold tracking-tight md:block">Descargas</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "ytdlp"
              ? "Las canciones de YouTube solo se pueden escuchar en streaming: no admiten descargas. Usa Navidrome para tener música sin conexión."
              : "Lo descargado se escucha sin conexión en este dispositivo. Descarga álbumes y listas con el botón ⤓ de su cabecera."}
          </p>
          {mounted && mode !== "ytdlp" && (
            <div className="flex max-w-md flex-col gap-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-foreground/80" style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatBytes(used)} de {formatBytes(limit)} · cambia el límite en Reproducción
              </p>
            </div>
          )}
        </div>
        {mounted && items.length === 0 && canDownload(mode) && (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <ArrowDownCircle className="size-10" />
            <p className="text-sm">Aún no has descargado nada.</p>
          </div>
        )}
        {items.length > 0 && (
          <section className="flex flex-col gap-1">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-lg font-bold">{items.length} {items.length === 1 ? "canción" : "canciones"}</h2>
              <Button variant="ghost" size="sm" className="rounded-full text-muted-foreground" onClick={async () => { if (await confirmDialog({ title: "¿Borrar todas las descargas?", description: "Tendrás que estar conectado para escuchar estas canciones.", confirmLabel: "Borrar todo", destructive: true })) void removeDownloads(items.map((i) => offlineKey(i.source, i.track.id))) }}>
                <Trash2 /> Borrar todo
              </Button>
            </div>
            <TrackList tracks={items.map((i) => i.track)} label="downloads" numbered={false} subline={(t) => <span className="text-muted-foreground/70"> · {formatBytes(all[offlineKey(mode!, t.id)]?.size ?? 0)}</span>} />
          </section>
        )}
      </div>
    </div>
  )
}
