"use client"

import { Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/profile/api"
import { useProfile, type ProfileUser } from "@/stores/profile"

/** Own password (needs the current one) or, with `target`, an admin reset. */
export function PasswordDialog({ open, onOpenChange, target, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; target?: { id: string; name: string }; onSaved?: () => void }) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [repeat, setRepeat] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const close = (v: boolean) => { if (!v) { setCurrent(""); setNext(""); setRepeat(""); setError(null) } onOpenChange(v) }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (next !== repeat) return setError("Las contraseñas no coinciden.")
    setBusy(true)
    setError(null)
    try {
      if (target) await api(`/api/admin/users/${target.id}`, { method: "PATCH", body: { password: next } })
      else {
        const { user } = await api<{ user: ProfileUser }>("/api/auth/password", { method: "POST", body: { current, next } })
        useProfile.setState({ user })
      }
      void useProfile.getState().check()
      toast(target ? `Contraseña de ${target.name} cambiada` : "Contraseña cambiada")
      onSaved?.()
      close(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="glass-player bg-[color-mix(in_oklab,var(--card)_62%,transparent)] border-0 ring-0 sm:max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{target ? `Contraseña de ${target.name}` : "Cambiar contraseña"}</DialogTitle>
            <DialogDescription>{target ? "Se cerrará su sesión en todos sus dispositivos." : "Tus otros dispositivos te pedirán la nueva."}</DialogDescription>
          </DialogHeader>
          {!target && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="pw-current">Contraseña actual</Label>
              <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="pw-next">Nueva contraseña</Label>
            <Input id="pw-next" type="password" autoComplete="new-password" minLength={15} value={next} onChange={(e) => setNext(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pw-repeat">Repítela</Label>
            <Input id="pw-repeat" type="password" autoComplete="new-password" minLength={15} value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
          </div>
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          <DialogFooter className="border-t-0 bg-transparent">
            <Button type="button" variant="ghost" onClick={() => close(false)}>Cancelar</Button>
            <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Guardar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
