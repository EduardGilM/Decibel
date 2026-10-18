"use client"

import { confirmDialog, promptDialog } from "@/components/ui/app-dialog"
import { MoreHorizontal, Pencil, Trash2, UserMinus, UserPlus, Users, X } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useState } from "react"
import { toast } from "sonner"
import { CollectionHeader, HeaderSkeleton } from "@/components/music/collection-header"
import { PlayButton } from "@/components/music/play-button"
import { ErrorState } from "@/components/music/states"
import { TopBar } from "@/components/music/top-bar"
import { TrackList, TrackListSkeleton } from "@/components/music/track-list"
import { DownloadButton } from "@/components/offline/download-button"
import { ProfileAvatar } from "@/components/profile/profile-avatar"
import { ShareDialog } from "@/components/profile/share-dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { formatLong } from "@/lib/format"
import { isProfilePlaylist, playlistActions, type ProfilePlaylist } from "@/lib/profile/provider"
import type { Playlist } from "@/lib/types"
import { useData } from "@/lib/use-data"

function SharedMeta({ pl }: { pl: ProfilePlaylist }) {
  const people = [{ id: pl.ownerId, name: pl.ownerName ?? pl.owner ?? "?" }, ...pl.members]
  return (
    <>
      {pl.shared && (
        <span className="mr-1 inline-flex -space-x-1.5" aria-hidden>
          {people.slice(0, 5).map((p) => <ProfileAvatar key={p.id} name={p.name} className="size-6 text-[11px] ring-2 ring-background" />)}
        </span>
      )}
      {pl.role !== "owner" && pl.owner && <span className="font-semibold">de {pl.owner}</span>}
      {pl.collaborative ? <span className="text-muted-foreground">· Colaborativa</span> : pl.shared && <span className="text-muted-foreground">· Compartida</span>}
      {pl.role === "viewer" && <span className="text-muted-foreground">· Solo lectura</span>}
    </>
  )
}

function PlaylistView() {
  const router = useRouter()
  const id = useSearchParams().get("id")
  const { data, error, loading } = useData(id ? `playlist:${id}` : null, (p) => p.getPlaylist(id!))
  const [local, setLocal] = useState<ProfilePlaylist | null>(null)
  const [sharing, setSharing] = useState(false)
  useEffect(() => setLocal(null), [data])
  const pl: Playlist | undefined = local ?? data
  const profile = isProfilePlaylist(id) && pl ? (pl as ProfilePlaylist) : null
  const label = `playlist:${id}`

  async function act<T>(work: Promise<T>, message?: string) {
    try { const r = await work; if (message) toast(message); return r } catch (e) { toast.error((e as Error).message) }
  }
  async function rename() {
    if (!profile) return
    const name = (await promptDialog({ title: "Cambiar nombre", label: "Nombre de la lista", initial: profile.name, confirmLabel: "Guardar" }))?.trim()
    if (name && name !== profile.name) { const r = await act(playlistActions.rename(profile.id, name)); if (r) setLocal(r) }
  }
  async function remove() {
    if (!profile || !(await confirmDialog({ title: `¿Eliminar «${profile.name}»?`, description: profile.shared ? "También desaparecerá para quien la comparte contigo. No se puede deshacer." : "Se borrará la lista. No se puede deshacer.", confirmLabel: "Eliminar", destructive: true }))) return
    if (await act(playlistActions.remove(profile.id), "Lista eliminada") !== undefined) router.replace("/library/")
  }
  async function leave() {
    if (!profile || !(await confirmDialog({ title: `¿Salir de «${profile.name}»?`, description: "Dejarás de verla en tu biblioteca.", confirmLabel: "Salir", destructive: true }))) return
    if (await act(playlistActions.leave(profile.id), "Has salido de la lista") !== undefined) router.replace("/library/")
  }

  return (
    <div>
      <TopBar />
      {loading && (
        <>
          <HeaderSkeleton />
          <TrackListSkeleton />
        </>
      )}
      {error && <ErrorState error={error} />}
      {pl && (
        <>
          <CollectionHeader
            kind={profile?.shared ? "Lista compartida" : "Playlist"}
            title={pl.name}
            coverArt={pl.coverArt}
            color={pl.color}
            meta={
              <>
                {pl.comment && <span className="w-full text-muted-foreground">{pl.comment}</span>}
                {profile ? <SharedMeta pl={profile} /> : pl.owner && <span className="font-semibold">{pl.owner}</span>}
                <span>
                  · {pl.songCount} canciones, {formatLong(pl.duration)}
                </span>
              </>
            }
          >
            <PlayButton tracks={pl.tracks} label={label} />
            <DownloadButton tracks={pl.tracks} />
            {profile?.role === "owner" && (
              <Button variant="ghost" size="icon-lg" className="rounded-full text-muted-foreground" aria-label="Compartir" onClick={() => setSharing(true)}>
                {profile.shared ? <Users /> : <UserPlus />}
              </Button>
            )}
            {profile && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-lg" className="rounded-full text-muted-foreground" aria-label="Más opciones">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {profile.role === "owner" ? (
                    <>
                      <DropdownMenuItem onSelect={rename}><Pencil /> Cambiar nombre</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setSharing(true)}><UserPlus /> Compartir</DropdownMenuItem>
                      <DropdownMenuItem onSelect={remove} variant="destructive"><Trash2 /> Eliminar lista</DropdownMenuItem>
                    </>
                  ) : (
                    <DropdownMenuItem onSelect={leave} disabled={profile.collaborative && !profile.members.length}><UserMinus /> Salir de la lista</DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </CollectionHeader>
          <div className="px-2 md:px-4">
            <TrackList
              tracks={pl.tracks ?? []}
              label={label}
              numbered
              subline={profile?.shared ? (t) => { const by = (t as { addedBy?: string }).addedBy; return by ? <span className="text-muted-foreground/70"> · añadida por {by}</span> : null } : undefined}
              trailing={profile?.editable ? (t) => (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 rounded-full text-muted-foreground opacity-60 hover:opacity-100"
                  aria-label={`Quitar ${t.title} de la lista`}
                  onClick={async (e) => {
                    e.stopPropagation()
                    const r = await act(playlistActions.removeTrack(profile.id, t.id), "Quitada de la lista")
                    if (r) setLocal(r)
                  }}
                >
                  <X />
                </Button>
              ) : undefined}
            />
          </div>
          {profile?.role === "owner" && <ShareDialog playlist={profile} open={sharing} onOpenChange={setSharing} onChange={setLocal} />}
        </>
      )}
    </div>
  )
}

export default function PlaylistPage() {
  return (
    <Suspense>
      <PlaylistView />
    </Suspense>
  )
}
