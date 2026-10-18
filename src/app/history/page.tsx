"use client"

import { confirmDialog } from "@/components/ui/app-dialog"
import { useSyncExternalStore } from "react"
import { History, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { TopBar } from "@/components/music/top-bar"
import { TrackList } from "@/components/music/track-list"
import { fromSource, groupByDay } from "@/lib/listen-history"
import { useHistory } from "@/stores/history"
import { api } from "@/lib/profile/api"
import { useProfile } from "@/stores/profile"
import { useSession } from "@/stores/session"

const subscribe = () => () => {}
/** History lives in localStorage: render it only on the client to avoid a hydration mismatch. */
const useMounted = () => useSyncExternalStore(subscribe, () => true, () => false)

export default function HistoryPage() {
  const mounted = useMounted()
  const all = useHistory((s) => s.entries)
  const mode = useSession((s) => s.mode)
  const profile = useProfile((s) => (s.status === "unavailable" ? null : s.user))
  const entries = fromSource(all, mode)
  const groups = mounted ? groupByDay(entries) : []
  return (
    <div>
      <TopBar title="Historial" />
      <div className="flex flex-col gap-6 px-2 pt-2 pb-8 md:px-4">
        <div className="flex items-end justify-between gap-3 px-2">
          <div>
            <h1 className="hidden text-3xl font-bold tracking-tight md:block">Historial</h1>
          </div>
          {entries.length > 0 && mounted && (
            <Button variant="ghost" size="sm" className="shrink-0 rounded-full text-muted-foreground" onClick={async () => {
              if (!(await confirmDialog({ title: profile ? "¿Borrar todo tu historial?" : "¿Borrar el historial de este dispositivo?", description: "No se puede deshacer.", confirmLabel: "Borrar", destructive: true }))) return
              if (profile && mode) void api(`/api/me/history?source=${mode}`, { method: "DELETE" }).catch(() => {})
              useHistory.getState().clear()
            }}>
              <Trash2 /> Borrar
            </Button>
          )}
        </div>
        {mounted && entries.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <History className="size-10" />
            <p className="text-sm">Aún no hay escuchas.</p>
          </div>
        )}
        {groups.map((group) => (
          <section key={group.label} className="flex flex-col gap-1">
            <h2 className="px-2 text-lg font-bold capitalize">{group.label}</h2>
            <TrackList tracks={group.entries.map((e) => e.track)} label={`history:${group.label}`} numbered={false} />
          </section>
        ))}
      </div>
    </div>
  )
}
