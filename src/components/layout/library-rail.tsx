"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ArrowDownCircle, Library, Loader2, Plus } from "lucide-react"
import { useState, type ReactNode } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverGlassContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Cover } from "@/components/music/cover"
import { hrefAlbum, hrefPlaylist } from "@/components/music/media-card"
import { useConnection } from "@/lib/offline/connection"
import { useProvider } from "@/lib/providers"
import { cn } from "@/lib/utils"
import { LikedCover, useLibrary } from "./app-sidebar"

function RailItem({ href, label, active, children }: { href: string; label: string; active?: boolean; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={href} aria-label={label} aria-current={active ? "page" : undefined} className={cn("block rounded-md p-1 outline-none transition-colors hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-ring", active && "bg-white/10")}>
          {children}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>{label}</TooltipContent>
    </Tooltip>
  )
}

/** "+" in the rail: names and creates an empty playlist, then opens it. */
function CreatePlaylistButton() {
  const provider = useProvider()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  if (!provider.createPlaylist) return null
  async function create() {
    if (!provider.createPlaylist || busy || !name.trim()) return
    setBusy(true); setError(undefined)
    try {
      const list = await provider.createPlaylist(name.trim())
      toast.success(`Lista «${list.name}» creada`)
      setOpen(false); setName("")
      router.push(hrefPlaylist(list.id))
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Popover open={open} onOpenChange={(v) => { if (!busy) { setOpen(v); setError(undefined) } }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="size-10 rounded-full bg-white/8 text-muted-foreground hover:bg-white/14 hover:text-foreground" aria-label="Crear lista"><Plus className="size-5" /></Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>Crear lista</TooltipContent>
      </Tooltip>
      <PopoverGlassContent side="right" align="start" className="w-72">
        <form className="flex flex-col gap-3 p-3.5" onSubmit={(e) => { e.preventDefault(); void create() }}>
          <p className="text-sm font-semibold">Crear lista</p>
          <Input autoFocus aria-label="Nombre de la lista" placeholder="Mi nueva lista" value={name} maxLength={80} disabled={busy} onChange={(e) => setName(e.target.value)} />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end"><Button type="submit" disabled={busy || !name.trim()} className="h-9 rounded-full px-4">{busy && <Loader2 className="animate-spin" />} Crear</Button></div>
        </form>
      </PopoverGlassContent>
    </Popover>
  )
}

/** Desktop left rail (Spotify collapsed library): library, create, then only artwork. */
export function LibraryRail() {
  const offline = useConnection((s) => s.showDownloads)
  return offline ? <nav aria-label="Tu biblioteca" className="hidden w-[72px] shrink-0 flex-col items-center rounded-2xl bg-card py-3 md:flex"><RailItem href="/downloads/" label="Descargadas" active><ArrowDownCircle className="size-10 p-2" /></RailItem></nav> : <OnlineLibraryRail />
}

function OnlineLibraryRail() {
  const pathname = usePathname()
  const params = useSearchParams()
  const id = params.get("id")
  const { data, loading } = useLibrary()
  const at = (path: string, itemId: string) => pathname.startsWith(path) && id === itemId
  return (
    <nav aria-label="Tu biblioteca" className="hidden w-[72px] shrink-0 flex-col items-center gap-2 rounded-2xl bg-card py-3 md:flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="ghost" size="icon" className={cn("size-10 rounded-full [&_svg]:size-6", pathname.startsWith("/library") ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
            <Link href="/library/" aria-label="Tu biblioteca"><Library /></Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>Tu biblioteca</TooltipContent>
      </Tooltip>
      <CreatePlaylistButton />
      <ScrollArea className="min-h-0 w-full flex-1 [&>[data-slot=scroll-area-viewport]>div]:block!">
        <ul className="flex flex-col items-center gap-1 pt-1 pb-2">
          <li><RailItem href="/downloads/" label="Descargadas" active={pathname.startsWith("/downloads")}><div className="flex size-12 items-center justify-center rounded-md bg-muted"><ArrowDownCircle className="size-6" /></div></RailItem></li>
          <li><RailItem href="/liked/" label="Tus me gusta" active={pathname.startsWith("/liked")}><LikedCover className="size-12 rounded-md" /></RailItem></li>
          {loading && Array.from({ length: 6 }).map((_, i) => <li key={i}><Skeleton className="m-1 size-12 rounded-md" /></li>)}
          {data?.playlists.map((p) => (
            <li key={p.id}><RailItem href={hrefPlaylist(p.id)} label={p.name} active={at("/playlist", p.id)}><Cover coverArt={p.coverArt} alt="" size={96} rounded="md" className="size-12" /></RailItem></li>
          ))}
          {data?.albums.map((a) => (
            <li key={a.id}><RailItem href={hrefAlbum(a.id)} label={`${a.name} · ${a.artist}`} active={at("/album", a.id)}><Cover coverArt={a.coverArt} alt="" size={96} rounded="md" className="size-12" /></RailItem></li>
          ))}
        </ul>
      </ScrollArea>
    </nav>
  )
}
