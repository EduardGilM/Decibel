"use client"

import { useEffect, useMemo, useState } from "react"
import { Check, ListMusic, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { glass, Popover, PopoverAnchor, PopoverGlassContent } from "@/components/ui/popover"
import { Cover } from "@/components/music/cover"
import { useProvider } from "@/lib/providers"
import type { Playlist } from "@/lib/types"
import { cn } from "@/lib/utils"
import { usePlaylistPicker } from "@/stores/playlist-picker"
import { findSameTrack } from "@/lib/track-identity"
import { usePlaylistMembership } from "@/stores/playlist-membership"

/** Single app-wide "add to playlist" popover, anchored to whichever ⊕ button opened it. */
export function PlaylistPicker() {
  const { track, trigger, close } = usePlaylistPicker()
  const provider = useProvider()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState<string>()
  const [retry, setRetry] = useState(0)
  const anchor = useMemo(() => ({ current: trigger ?? null }), [trigger])
  const membership = usePlaylistMembership((s) => s.lists)
  const contains = (playlist: Playlist) => !!track && (!!findSameTrack(playlist.tracks, track) || !!findSameTrack(membership[playlist.id], track))

  useEffect(() => {
    if (!track) return
    let alive = true
    setLoading(true)
    setError(undefined)
    setCreating(false)
    setName("")
    provider.getPlaylists()
      .then((lists) => { if (alive) setPlaylists(lists.filter((list) => list.editable === true)) })
      .catch(() => { if (alive) setError("No se han podido cargar tus listas.") })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [track, provider, retry])

  async function save(playlist?: Playlist) {
    if (!track || busy || !provider.createPlaylist || !provider.addToPlaylist) return
    if (playlist && contains(playlist)) { toast(`Ya está en la lista «${playlist.name}»`); close(); return }
    setBusy(true)
    setError(undefined)
    try {
      const saved = playlist ? await provider.addToPlaylist(playlist.id, track) : await provider.createPlaylist(name.trim(), track)
      usePlaylistMembership.getState().add(saved.id, track) // ⊕ turns green at once; the refresh confirms it
      toast.success(playlist ? `Añadida a «${saved.name}»` : `Lista «${saved.name}» creada con esta canción`)
      close()
    } catch (error) {
      // The server found the same song already there (another id / source): same answer as the local check.
      if (playlist && (error as Error).message === "Ya está en la lista.") { usePlaylistMembership.getState().add(playlist.id, track); toast(`Ya está en la lista «${playlist.name}»`); close() }
      else setError((error as Error).message)
    }
    finally { setBusy(false) }
  }

  return (
    <Popover open={!!track && !!trigger} onOpenChange={(open) => { if (!open && !busy) close() }}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverGlassContent
        side="top"
        align="center"
        hideWhenDetached
        className="w-72 max-w-[calc(100vw-16px)]"
        aria-label={creating ? "Crear lista" : "Añadir a una lista"}
        onInteractOutside={(event) => { if (trigger?.contains(event.target as Node)) event.preventDefault() }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (trigger?.isConnected) trigger.focus()
          else document.getElementById("search-input")?.focus()
        }}
      >
        {/* Direct children of the glass body only: the footer's own backdrop-filter must have no
            opacity/filter ancestor, and the body fades its children one by one. */}
        <div className="px-3.5 pt-3 pb-1.5">
          <p className="text-sm font-semibold">{creating ? "Crear lista" : "Añadir a una lista"}</p>
          {!creating && <p className="truncate text-xs text-muted-foreground">{track?.title} · {track?.artist}</p>}
        </div>
        {creating ? (
          <form className="flex flex-col gap-3 px-3.5 pt-1 pb-3.5" onSubmit={(event) => { event.preventDefault(); void save() }}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="playlist-name">Nombre de la lista</Label>
              <Input id="playlist-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required disabled={busy} placeholder="Mi nueva lista" />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={busy} className="h-9 rounded-full bg-white/10 px-4 hover:bg-white/15" onClick={() => { setCreating(false); setError(undefined) }}>Volver</Button>
              <Button type="submit" disabled={busy || !name.trim()} className="h-9 rounded-full px-4">{busy && <Loader2 className="animate-spin" />} Crear y añadir</Button>
            </div>
          </form>
        ) : (
          <>
            {loading && <p role="status" className="flex items-center gap-2 px-3.5 py-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Cargando tus listas…</p>}
            {error && <div role="alert" className="px-3.5 text-sm text-muted-foreground"><p>{error}</p><Button variant="link" className="px-0" onClick={() => setRetry((value) => value + 1)}>Reintentar</Button></div>}
            {!loading && !error && !playlists.length && <p className="px-3.5 pt-2 pb-16 text-sm text-muted-foreground">Todavía no tienes listas.</p>}
            {!loading && !error && playlists.length > 0 && (
              <div role="list" className="max-h-80 overflow-y-auto overscroll-contain px-1.5 pb-[3.75rem] [scrollbar-width:none]">
                {playlists.map((playlist) => {
                  const added = contains(playlist)
                  return (
                    <button key={playlist.id} role="listitem" type="button" disabled={busy} aria-label={added ? `${playlist.name}: ya está en esta lista` : `Añadir a ${playlist.name}`} className="flex w-full items-center gap-3 rounded-md p-1.5 text-left outline-none hover:bg-white/8 focus-visible:bg-white/10 disabled:opacity-60" onClick={() => void save(playlist)}>
                      {playlist.coverArt ? <Cover coverArt={playlist.coverArt} alt="" size={96} rounded="sm" className="size-9" /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-white/8"><ListMusic className="size-4 text-muted-foreground" /></span>}
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{playlist.name}</span><span className="block text-xs text-muted-foreground">{added ? "Ya está en esta lista" : `${playlist.songCount} canciones`}</span></span>
                      {added && <Check className="size-4 shrink-0 text-primary" />}
                    </button>
                  )
                })}
              </div>
            )}
            {/* Frosted footer floating over the list: rows scroll underneath it. */}
            <Button variant="ghost" disabled={busy} className={cn(glass.footer, "absolute inset-x-1.5 bottom-1.5 h-11 justify-start gap-3 rounded-[10px] px-3 hover:bg-white/10")} onClick={() => { setCreating(true); setError(undefined) }}><Plus className="size-5" /> Crear lista nueva</Button>
          </>
        )}
      </PopoverGlassContent>
    </Popover>
  )
}
