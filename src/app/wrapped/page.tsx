"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { Loader2 } from "lucide-react"
import { WrappedEmpty, WrappedStories } from "@/components/wrapped/wrapped-stories"
import { fromSource, type HistoryEntry } from "@/lib/listen-history"
import { api } from "@/lib/profile/api"
import { computeWrapped, type WrappedRange } from "@/lib/wrapped"
import { useHistory } from "@/stores/history"
import { useProfile } from "@/stores/profile"
import { useSession } from "@/stores/session"

const subscribe = () => () => {}
const useMounted = () => useSyncExternalStore(subscribe, () => true, () => false)

/** Whole profile history the server returns (it keeps up to 5000 listens; the API serves the latest 2000). */
const WRAPPED_HISTORY_LIMIT = 2000

/**
 * Data: the signed-in profile's listening history from the server (GET /api/me/history); without a profile,
 * this device's local history. Everything is computed here (src/lib/wrapped.ts); podcasts never count.
 */
function useWrappedHistory() {
  const user = useProfile((s) => (s.status === "ready" ? s.user : null))
  const mode = useSession((s) => s.mode)
  const local = useHistory((s) => s.entries)
  const [remote, setRemote] = useState<{ key: string; entries: HistoryEntry[] | null }>()
  const key = user && mode ? `${user.id}:${mode}` : ""
  useEffect(() => {
    if (!key || !mode) return
    let alive = true
    api<HistoryEntry[]>(`/api/me/history?source=${mode}&limit=${WRAPPED_HISTORY_LIMIT}`)
      .then((entries) => { if (alive) setRemote({ key, entries }) })
      .catch(() => { if (alive) setRemote({ key, entries: null }) })
    return () => { alive = false }
  }, [key, mode])
  if (!key) return { entries: fromSource(local, mode), loading: false }
  if (remote?.key !== key) return { entries: [], loading: true }
  // Server unreachable: the local cache of this profile's history (latest 500) is still real data.
  return { entries: remote.entries ?? fromSource(local, mode), loading: false }
}

export default function WrappedPage() {
  const mounted = useMounted()
  const router = useRouter()
  const [range, setRange] = useState<WrappedRange>("year")
  const { entries, loading } = useWrappedHistory()
  const stats = useMemo(() => computeWrapped(entries, range), [entries, range])
  const close = useCallback(() => {
    if (window.history.length > 1) router.back()
    else router.replace("/")
  }, [router])

  useEffect(() => {
    const html = document.documentElement
    const previous = html.style.overflow
    html.style.overflow = "hidden"
    return () => { html.style.overflow = previous }
  }, [])

  return (
    <div role="dialog" aria-modal="true" aria-label="Tu Wrapped" data-state="open" className="fixed inset-0 z-[80] bg-[#0b0b0d] text-white">
      {!mounted || loading ? (
        <div className="flex h-full items-center justify-center"><Loader2 className="size-8 animate-spin text-white/70" aria-label="Cargando" /></div>
      ) : stats.enough ? (
        <WrappedStories key={range} stats={stats} range={range} onRange={setRange} onClose={close} />
      ) : (
        <WrappedEmpty stats={stats} range={range} onRange={setRange} onClose={close} />
      )}
    </div>
  )
}
