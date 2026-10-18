"use client"

import { KeyRound, Loader2, MoreHorizontal, Plus, ShieldCheck, UserCheck, UserX } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { TopBar } from "@/components/music/top-bar"
import { PasswordDialog } from "@/components/profile/password-dialog"
import { ProfileAvatar } from "@/components/profile/profile-avatar"
import { confirmDialog } from "@/components/ui/app-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/profile/api"
import { cn } from "@/lib/utils"
import { useProfile } from "@/stores/profile"

interface AdminUser {
  id: string
  name: string
  role: "admin" | "user"
  color?: string
  weakPassword: boolean
  active: boolean
  lastSeen: number | null
}

const seenLabel = (t: number | null) => {
  if (!t) return "Nunca ha entrado"
  const days = Math.floor((Date.now() - t) / 86_400_000)
  return days <= 0 ? "Activo hoy" : days === 1 ? "Activo ayer" : `Activo hace ${days} días`
}

const glassDialog = "glass-player bg-[color-mix(in_oklab,var(--card)_62%,transparent)] border-0 ring-0 sm:max-w-sm"
const pill = "h-11 rounded-full border-0 bg-white/[0.08] px-4 text-[15px] shadow-none focus-visible:ring-2"

/** «+ Nuevo perfil»: name and initial password, both as pills. */
function NewProfileDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = (v: boolean) => { if (!v) { setName(""); setPassword(""); setError(null) } onOpenChange(v) }
  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api("/api/admin/users", { method: "POST", body: { name: name.trim(), password } })
      toast(`Perfil ${name.trim()} creado`)
      onCreated()
      close(false)
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={glassDialog}>
        <form onSubmit={create} className="flex flex-col gap-3">
          <DialogHeader className="mb-1">
            <DialogTitle>Nuevo perfil</DialogTitle>
            <DialogDescription className="sr-only">Nombre y contraseña inicial del nuevo perfil.</DialogDescription>
          </DialogHeader>
          <Input aria-label="Nombre" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required autoFocus className={pill} />
          <Input aria-label="Contraseña" placeholder="Contraseña" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={4} required className={pill} />
          {error && <p role="alert" className="px-1 text-sm text-red-400">{error}</p>}
          <Button type="submit" disabled={busy} className="mt-2 h-11 rounded-full text-[15px]">{busy && <Loader2 className="animate-spin" />} Crear perfil</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function AdminPage() {
  const me = useProfile((s) => s.user)
  const status = useProfile((s) => s.status)
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reset, setReset] = useState<AdminUser | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(() => {
    api<AdminUser[]>("/api/admin/users").then(setUsers).catch((e: Error) => setError(e.message))
    void useProfile.getState().check()
  }, [])
  useEffect(() => { if (me?.role === "admin") load() }, [me?.role, load])

  async function toggle(user: AdminUser, active: boolean) {
    if (!active && !(await confirmDialog({ title: `¿Desactivar a ${user.name}?`, description: "No podrá entrar y se cerrarán sus sesiones. Sus datos se conservan.", confirmLabel: "Desactivar", destructive: true }))) return
    try {
      await api(`/api/admin/users/${user.id}`, { method: "PATCH", body: { active } })
      toast(active ? `${user.name} activado` : `${user.name} desactivado`)
      load()
    } catch (e) { toast.error((e as Error).message) }
  }

  const admin = me?.role === "admin"

  return (
    <div>
      <TopBar title="Perfiles" />
      <div className="mx-auto flex max-w-xl flex-col gap-5 px-4 pt-3 pb-10 md:px-6">
        <h1 className="hidden text-3xl font-bold tracking-tight md:block">Perfiles</h1>

        {status !== "checking" && !admin && <p className="text-sm text-muted-foreground">Solo el administrador puede gestionar perfiles.</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}

        {users && (
          <ul className="overflow-hidden rounded-2xl bg-white/[0.07] [&>*+*]:shadow-[inset_0_0.5px_0_0_rgb(255_255_255/0.08)]">
            {users.map((u) => {
              const self = u.id === me?.id
              return (
                <li key={u.id} className="flex min-h-[64px] items-center gap-3.5 py-2.5 pr-2 pl-4">
                  <ProfileAvatar name={u.name} color={u.color} className={cn("size-10 text-base", !u.active && "opacity-45")} />
                  <div className={cn("min-w-0 flex-1", !u.active && "opacity-55")}>
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] font-medium">{u.name}</span>
                      {u.role === "admin" && <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground/80" aria-label="Administrador" />}
                      {self && <span className="text-xs text-muted-foreground/80">(tú)</span>}
                    </div>
                    <p className="truncate text-xs text-muted-foreground/80">{u.active ? seenLabel(u.lastSeen) : "Desactivado"}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-10 rounded-full text-muted-foreground" aria-label={`Opciones de ${u.name}`}>
                        <MoreHorizontal className="size-5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onSelect={() => setReset(u)}><KeyRound /> Cambiar contraseña</DropdownMenuItem>
                      {/* the admin cannot lock themself out */}
                      {!self && (u.active
                        ? <DropdownMenuItem variant="destructive" onSelect={() => void toggle(u, false)}><UserX /> Desactivar</DropdownMenuItem>
                        : <DropdownMenuItem onSelect={() => void toggle(u, true)}><UserCheck /> Activar</DropdownMenuItem>)}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              )
            })}
          </ul>
        )}
        {admin && !users && !error && <Loader2 className="size-5 animate-spin text-muted-foreground" />}

        {admin && (
          <Button onClick={() => setCreating(true)} className="h-11 self-start rounded-full px-5 text-[15px]">
            <Plus /> Nuevo perfil
          </Button>
        )}
      </div>
      <NewProfileDialog open={creating} onOpenChange={setCreating} onCreated={load} />
      {/* own row: own password change (asks for the current one); others: admin reset */}
      <PasswordDialog open={!!reset} onOpenChange={(v) => !v && setReset(null)} target={reset && reset.id !== me?.id ? reset : undefined} onSaved={load} />
    </div>
  )
}
