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

/** One segment of the pill control (filter-chip look: the selected segment is filled with the accent). */
const SEGMENT = "h-7 rounded-full! border-0 bg-transparent px-3 text-xs font-medium text-foreground shadow-none hover:bg-foreground/10 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary/90"

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
          <DialogTitle className="truncate pr-6 text-base">Compartir «{playlist.name}»</DialogTitle>
          <DialogDescription className="sr-only">Elige quién puede ver o editar esta lista.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.04] px-4 py-2.5">
          <Label htmlFor="collaborative" className="text-sm font-medium">Colaborativa</Label>
          <Switch id="collaborative" checked={playlist.collaborative} disabled={busy} onCheckedChange={(v) => run(playlistActions.setCollaborative(playlist.id, v), v ? "Lista colaborativa" : "Ya no es colaborativa")} />
        </div>
        <ul className="flex flex-col gap-1">
          {profiles.filter((p) => p.id !== playlist.ownerId).map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-1.5">
              <ProfileAvatar name={p.name} color={p.color} own className="size-9 text-sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
              <ToggleGroup
                type="single"
                className="shrink-0 rounded-full bg-foreground/10 p-0.5"
                value={playlist.collaborative && access(p.id) === "none" ? "editor" : access(p.id)}
                disabled={busy || playlist.collaborative}
                onValueChange={(v) => {
                  if (!v || v === access(p.id)) return
                  run(playlistActions.setMember(playlist.id, p.id, v === "none" ? null : (v as "viewer" | "editor")), v === "none" ? `${p.name} ya no tiene acceso` : `${p.name} ${v === "editor" ? "puede editar" : "puede verla"}`)
                }}
                aria-label={`Acceso de ${p.name}`}
              >
                <ToggleGroupItem value="none" className={SEGMENT}>No</ToggleGroupItem>
                <ToggleGroupItem value="viewer" className={SEGMENT}>Ver</ToggleGroupItem>
                <ToggleGroupItem value="editor" className={SEGMENT}>Editar</ToggleGroupItem>
              </ToggleGroup>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
