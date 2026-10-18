"use client"

import { Loader2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { DecibelMark } from "@/components/brand/logo"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { importLocalData, markImported, resetForProfile, stashHistory, useLocalImport, useProfileSync, type LocalData } from "@/lib/profile/sync"
import { useRecentSearchSync } from "@/lib/profile/search-sync"
import { useProfile } from "@/stores/profile"

/** No session on this device: name + password only (profile names are not listed). Asked once per device. */
function SignIn() {
  const login = useProfile((s) => s.login)
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const passwordInput = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !name.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      resetForProfile()
      await login(name.trim(), password)
    } catch (err) {
      setError((err as Error).message)
      setPassword("")
      passwordInput.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-y-auto bg-background px-6 pt-[max(var(--safe-top),24px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col items-center gap-4">
        <DecibelMark className="size-14" />
        <h1 className="mb-2 text-2xl font-semibold tracking-tight">Entra en Decibel</h1>
        <Input
          aria-label="Nombre"
          placeholder="Nombre"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-12 rounded-full px-5 text-center text-base"
        />
        <Input
          ref={passwordInput}
          type="password"
          autoComplete="current-password"
          aria-label="Contraseña"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={!!error}
          className="h-12 rounded-full px-5 text-center text-base"
        />
        {error && <p role="alert" className="text-center text-sm text-red-400">{error}</p>}
        <Button type="submit" className="mt-1 h-11 w-full rounded-full" disabled={busy || !name.trim() || !password}>
          {busy && <Loader2 className="animate-spin" />} Entrar
        </Button>
      </form>
    </div>
  )
}

function ImportPrompt({ data, onDone }: { data: LocalData; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const parts = [
    data.playlists.length && `${data.playlists.length} ${data.playlists.length === 1 ? "lista" : "listas"}`,
    data.likes.length && `${data.likes.length} me gusta`,
    data.history.length && `${data.history.length} escuchas`,
  ].filter(Boolean)
  async function run() {
    setBusy(true)
    try {
      const r = await importLocalData(data)
      toast(`Importado: ${r.playlists} listas, ${r.likes} me gusta, ${r.history} escuchas`)
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>¿Traer lo guardado en este dispositivo?</DialogTitle>
          <DialogDescription>
            Hay {parts.join(", ")} de antes de usar perfiles. Si son tuyos, pásalos a tu perfil; si no, déjalos para quien los guardó.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { markImported(data.source); onDone() }} disabled={busy}>No son míos</Button>
          <Button variant="ghost" onClick={onDone} disabled={busy}>Ahora no</Button>
          <Button onClick={run} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Pasar a mi perfil</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Profiles: checks the session once per load; asks for name + password only without one. */
export function ProfileGate() {
  const status = useProfile((s) => s.status)
  const hasUser = useProfile((s) => !!s.user)
  const check = useProfile((s) => s.check)
  const { data, dismiss } = useLocalImport()
  useProfileSync()
  useRecentSearchSync()

  useEffect(() => { void check() }, [check])
  useEffect(() => {
    if (status === "anon") stashHistory()
  }, [status])

  if (status === "anon") return <SignIn />
  if ((status === "checking" || status === "error") && !hasUser) return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-background px-6 text-center">
      <DecibelMark className="size-12" />
      {status === "checking" ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Conectando con el servidor…</p> : <div role="alert" className="flex flex-col items-center gap-4">
        <p>No se puede conectar con el servidor.</p>
        <Button onClick={() => void check()}>Reintentar</Button>
      </div>}
    </div>
  )
  return data ? <ImportPrompt data={data} onDone={dismiss} /> : null
}
