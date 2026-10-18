"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/profile/api"
import { playlistActions, type ProfilePlaylist } from "@/lib/profile/provider"
import type { PublicProfile } from "@/stores/profile"
import { ProfileAvatar } from "./profile-avatar"

type Access = "none" | "viewer" | "editor"

/** Owner-only: invite profiles as reader/editor or open the list to everyone (collaborative). */
export function ShareDialog({ playlist, open, onOpenChange, onChange }: { playlist: ProfilePlaylist; open: boolean; onOpenChange: (v: boolean) => void; onChange: (p: ProfilePlaylist) => void }) {
  const [profiles, setProfiles] = useState<PublicProfile[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) api<PublicProfile[]>("/api/auth/profiles").then(setProfiles).catch(() => {}) }, [open])

  const access = (id: string): Access => playlist.members.find((m) => m.id === id)?.role ?? "none"
  async function run(work: Promise<ProfilePlaylist>, message: string) {
    setBusy(true)
    try { onChange(await work); toast(message) } catch (e) { toast.error((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Compartir «{playlist.name}»</DialogTitle>
          <DialogDescription>Quien pueda editar podrá añadir, quitar y ordenar canciones. Verás quién añadió cada una.</DialogDescription>
        </DialogHeader>
        <div className="flex items-start justify-between gap-4 rounded-xl bg-white/[0.04] px-4 py-3">
          <div>
            <Label htmlFor="collaborative" className="text-sm font-medium">Colaborativa</Label>
            <p className="mt-1 text-xs text-muted-foreground">Todos los perfiles de este servidor pueden verla y añadir canciones.</p>
          </div>
          <Switch id="collaborative" checked={playlist.collaborative} disabled={busy} onCheckedChange={(v) => run(playlistActions.setCollaborative(playlist.id, v), v ? "Lista colaborativa" : "Ya no es colaborativa")} />
        </div>
        <ul className="flex flex-col gap-1">
          {profiles.filter((p) => p.id !== playlist.ownerId).map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-1.5">
              <ProfileAvatar name={p.name} color={p.color} className="size-9 text-sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={playlist.collaborative && access(p.id) === "none" ? "editor" : access(p.id)}
                disabled={busy || playlist.collaborative}
                onValueChange={(v) => {
                  if (!v || v === access(p.id)) return
                  run(playlistActions.setMember(playlist.id, p.id, v === "none" ? null : (v as "viewer" | "editor")), v === "none" ? `${p.name} ya no tiene acceso` : `${p.name} ${v === "editor" ? "puede editar" : "puede verla"}`)
                }}
                aria-label={`Acceso de ${p.name}`}
              >
                <ToggleGroupItem value="none" className="px-2.5 text-xs data-[state=on]:border-white data-[state=on]:bg-white data-[state=on]:text-black">No</ToggleGroupItem>
                <ToggleGroupItem value="viewer" className="px-2.5 text-xs data-[state=on]:border-white data-[state=on]:bg-white data-[state=on]:text-black">Ver</ToggleGroupItem>
                <ToggleGroupItem value="editor" className="px-2.5 text-xs data-[state=on]:border-white data-[state=on]:bg-white data-[state=on]:text-black">Editar</ToggleGroupItem>
              </ToggleGroup>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
