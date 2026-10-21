"use client"

import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/profile/api"
import { clearDataCache } from "@/lib/use-data"
import { useUi } from "@/stores/ui"
import { hrefPlaylist } from "./media-card"

interface Job {
  status: "reading" | "matching" | "saving" | "done" | "error"
  done: number
  total: number
  result?: { playlist: { id: string; name: string; songCount: number }; missing: number }
  error?: string
}

const running = (job: Job | null) => !!job && ["reading", "matching", "saving"].includes(job.status)
const progress = (job: Job) => {
  const label = job.status === "reading" ? "Leyendo lista" : job.status === "saving" ? "Guardando lista" : "Buscando canciones"
  return job.total && job.status !== "saving" ? `${label}… ${job.done} de ${job.total}` : `${label}…`
}

/** One public playlist, independent of the account import. Mounted globally to follow background progress. */
export function PlaylistImport({ profileId }: { profileId: string }) {
  const router = useRouter()
  const open = useUi((s) => s.playlistImportOpen)
  const [url, setUrl] = useState("")
  const [job, setJob] = useState<Job | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signal = useRef<AbortSignal | undefined>(undefined)
  const request = useRef(0)
  const expecting = useRef(false)
  const quiet = useRef(false)
  const toastId = `playlist-import-${profileId}`
  const active = running(job)
  const busy = active || submitting

  const load = useCallback(async () => {
    const version = ++request.current
    const current = signal.current
    try {
      const next = await api<{ job: Job | null }>("/api/playlist-import", { signal: current })
      if (version === request.current && !current?.aborted) setJob(next.job)
    } catch (err) {
      if (version === request.current && !current?.aborted && useUi.getState().playlistImportOpen) setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    signal.current = controller.signal
    void load()
    return () => { controller.abort(); toast.dismiss(toastId) }
  }, [load, toastId])
  useEffect(() => {
    if (open) { setError(null); void load() }
  }, [open, load])
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => void load(), 2000)
    return () => clearInterval(timer)
  }, [active, load])

  useEffect(() => {
    if (job && running(job)) {
      expecting.current = true
      if (!quiet.current) toast.loading(progress(job), { id: toastId, onDismiss: () => { quiet.current = true } })
      return
    }
    if (!expecting.current) return
    expecting.current = false
    if (!job || job.status === "error") {
      const message = job?.error ?? "La importación de la lista se ha interrumpido. Vuelve a intentarlo."
      if (useUi.getState().playlistImportOpen) { toast.dismiss(toastId); setError(message) }
      else toast.error(message, { id: toastId })
      return
    }
    if (!job.result) return
    const { playlist, missing } = job.result
    clearDataCache()
    window.dispatchEvent(new Event("decibel:data-changed"))
    useUi.setState({ playlistImportOpen: false })
    setUrl("")
    toast.success(`«${playlist.name}» importada`, {
      id: toastId,
      description: `${playlist.songCount} ${playlist.songCount === 1 ? "canción" : "canciones"}${missing ? ` · ${missing} ${missing === 1 ? "no disponible" : "no disponibles"}` : ""}`,
      action: { label: "Ver lista", onClick: () => router.push(hrefPlaylist(playlist.id)) },
    })
  }, [job, router, toastId])

  async function start() {
    if (busy || !url.trim()) return
    setSubmitting(true); setError(null)
    quiet.current = false
    request.current++
    const current = signal.current
    try {
      const next = await api<Job>("/api/playlist-import", { method: "POST", body: { url: url.trim() }, signal: current })
      if (current?.aborted) return
      expecting.current = true
      setJob(next)
      useUi.setState({ playlistImportOpen: false })
    } catch (err) {
      if (current?.aborted) return
      setError((err as Error).message)
      // The server may have accepted the job even if the response was lost.
      void load()
    } finally { if (!current?.aborted) setSubmitting(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(playlistImportOpen) => useUi.setState({ playlistImportOpen })}>
      <DialogContent className="glass-player border-0 ring-0 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Importar lista</DialogTitle>
          <DialogDescription className="sr-only">Importa una lista pública de Spotify.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void start() }}>
          {active && job ? (
            <div role="status" className="flex flex-col gap-2 text-sm">
              <p className="flex items-center gap-2"><Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />{progress(job)}</p>
              {job.total > 0 && (
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round(job.done / job.total * 100)}%` }} />
                </div>
              )}
            </div>
          ) : (
            <Input id="playlist-import-url" aria-label="Enlace de Spotify" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus placeholder="Enlace de Spotify" value={url} maxLength={2048} disabled={submitting} onChange={(event) => setUrl(event.target.value)} required />
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="border-t-0 bg-transparent">
            {active ? <Button type="button" variant="ghost" className="h-11 rounded-full" onClick={() => useUi.setState({ playlistImportOpen: false })}>Cerrar</Button>
              : <Button type="submit" className="h-11 w-full rounded-full px-6" disabled={busy || !url.trim()}>{submitting && <Loader2 className="animate-spin" />}Importar</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
