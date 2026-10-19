"use client"

import { Loader2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api, serverBase } from "@/lib/profile/api"
import { getProvider } from "@/lib/providers"
import { clearDataCache } from "@/lib/use-data"
import { useProfile } from "@/stores/profile"
import { useUi } from "@/stores/ui"

// Free, open source and already allowed by Spotify: it downloads every list and the liked songs as one ZIP.
const EXPORTIFY = "https://exportify.app/"

interface Job {
  status: "connecting" | "matching" | "saving" | "done" | "error"
  done: number
  total: number
  result?: { playlists: number; likes: number; missing: number }
  error?: string
}
interface Status { configured: boolean; job: Job | null }

const TOAST = "spotify-import"
const running = (job?: Job | null) => !!job && ["connecting", "matching", "saving"].includes(job.status)
const progress = (job: Job) => job.status === "matching" && job.total ? `Importando de Spotify… ${job.done} de ${job.total}` : "Importando de Spotify…"
const summary = ({ playlists, likes }: NonNullable<Job["result"]>) => `${playlists} ${playlists === 1 ? "lista" : "listas"} y ${likes} «Me gusta»`

/** Android app: the system browser; elsewhere a new tab. */
function openExternal(url: string) {
  if (window.DecibelNative?.openUrl) window.DecibelNative.openUrl(url)
  else window.open(url, "_blank", "noopener")
}

/**
 * «Importar de Spotify». Without a Spotify app on the server: Exportify's ZIP, chosen here. With one: a single
 * button to Spotify's consent screen. Either way the server finds the songs on YouTube Music and saves them to
 * this profile. Mounted once; while an import runs it keeps polling with the dialog closed too.
 */
export function SpotifyImport() {
  const open = useUi((s) => s.spotifyOpen)
  const profile = useProfile((s) => s.user)
  const [configured, setConfigured] = useState(false)
  const [job, setJob] = useState<Job | null>(null)
  const [waiting, setWaiting] = useState<"spotify" | "file" | null>(null)
  const [result, setResult] = useState<Job["result"]>()
  const [error, setError] = useState<string | null>(null)
  // Only an import started or seen running here reports its end (an old result is not shown again).
  const expecting = useRef(false)
  // The progress notice was swiped away: no more updates until the next import.
  const quiet = useRef(false)
  // A running import was seen: if the server then has none, it was lost (restart).
  const seen = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const busy = running(job) || !!waiting

  const load = useCallback(() => api<Status>("/api/spotify").then(
    (next) => { setJob(next.job); setConfigured(next.configured) },
    (err: Error) => { if (useUi.getState().spotifyOpen) setError(err.message) },
  ), [])
  const close = () => { useUi.setState({ spotifyOpen: false }); setWaiting(null); setResult(undefined); setError(null) }

  useEffect(() => {
    // An import that kept running on the server (app closed, back from Spotify) shows its progress again.
    void load()
    const url = new URL(window.location.href)
    if (!url.searchParams.has("spotify")) return
    url.searchParams.delete("spotify")
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
    expecting.current = true
  }, [load])
  useEffect(() => { if (open) void load() }, [open, load])
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => void load(), 2000)
    return () => clearInterval(timer)
  }, [busy, load])

  // The import runs in the background: the dialog steps aside and a small notice keeps the count.
  useEffect(() => {
    if (job && running(job)) {
      expecting.current = true
      seen.current = true
      if (waiting) { setWaiting(null); useUi.setState({ spotifyOpen: false }) }
      if (!quiet.current) toast.loading(progress(job), { id: TOAST, onDismiss: () => { quiet.current = true } })
      return
    }
    if (!job) {
      // The server lost the import (restarted): the progress notice must not spin forever.
      if (seen.current && !waiting) {
        seen.current = expecting.current = false
        toast.error("La importación se ha interrumpido. Vuelve a intentarlo.", { id: TOAST })
      }
      return
    }
    seen.current = false
    setWaiting(null)
    if (!expecting.current) return
    expecting.current = false
    const shown = useUi.getState().spotifyOpen
    if (job.status === "error") {
      const message = job.error ?? "No se ha podido importar de Spotify."
      if (shown) { toast.dismiss(TOAST); setError(message) } else toast.error(message, { id: TOAST })
      return
    }
    clearDataCache()
    void getProvider().getStarred().catch(() => {})
    window.dispatchEvent(new Event("decibel:data-changed"))
    if (shown) { toast.dismiss(TOAST); setResult(job.result) }
    else if (job.result) toast.success(`Importado de Spotify: ${summary(job.result)}`, { id: TOAST })
  }, [job, waiting])

  function begin(kind: "spotify" | "file") {
    expecting.current = true
    quiet.current = false
    setWaiting(kind); setResult(undefined); setError(null)
  }
  function failed(err: unknown) {
    expecting.current = false
    setWaiting(null)
    setError((err as Error).message)
  }

  async function upload(file?: File) {
    if (!file) return
    begin("file")
    try {
      // Running: the effect above closes the dialog and shows the progress notice.
      setJob(await api<Job>(`/api/spotify/file?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file }))
    } catch (err) { failed(err) }
  }

  async function connect() {
    begin("spotify")
    try {
      const android = !!window.DecibelNative?.openUrl
      const { url } = await api<{ url: string }>("/api/spotify/connect", { method: "POST", body: { base: serverBase() || window.location.origin, returnTo: android ? undefined : window.location.origin } })
      setJob(null)
      // Android: Spotify opens in the system browser. Web and desktop: this window goes to Spotify and comes back.
      if (android) window.DecibelNative!.openUrl!(url)
      else window.location.assign(url)
    } catch (err) { failed(err) }
  }

  const status = waiting === "file" ? "Subiendo el archivo…" : job?.status === "matching" && job.total ? `Importando… ${job.done} de ${job.total}`
    : job?.status === "saving" ? "Guardando…" : job ? "Preparando…" : "Esperando a Spotify…"
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent className="glass-player border-0 ring-0 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Importar de Spotify</DialogTitle>
          <DialogDescription className="sr-only">Tus listas y «Me gusta» de Spotify, en el perfil de {profile?.name}.</DialogDescription>
        </DialogHeader>
        {busy && (
          <div role="status" className="flex flex-col gap-2 text-sm">
            <p className="flex items-center gap-2"><Loader2 className="size-4 animate-spin text-muted-foreground" /> {status}</p>
            {job?.status === "matching" && job.total > 0 && (
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round((job.done / job.total) * 100)}%` }} />
              </div>
            )}
          </div>
        )}
        {result && <p role="status" className="text-sm">Listo: {summary(result)}.</p>}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        {!configured && !busy && !result && (
          <div className="flex flex-col gap-2">
            <Button variant="secondary" className="h-11 rounded-full" onClick={() => openExternal(EXPORTIFY)}>1. Abrir Exportify</Button>
            <p className="pb-1 text-center text-xs text-muted-foreground">Entra con Spotify y pulsa «Exportar todo».</p>
            <Button className="h-11 rounded-full" onClick={() => input.current?.click()}>2. Elegir el archivo descargado</Button>
            <input ref={input} type="file" accept=".zip,.csv,.json,application/zip,text/csv,application/json" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = "" }} />
          </div>
        )}
        {(busy || result || configured) && (
          <DialogFooter className="border-t-0 bg-transparent">
            {busy || result ? <Button variant={busy ? "ghost" : "default"} className="h-11 rounded-full px-6" onClick={close}>Cerrar</Button> : <Button className="h-11 rounded-full px-6" onClick={() => void connect()}>Importar</Button>}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
