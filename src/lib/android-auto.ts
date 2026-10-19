import type { MusicProvider, Track } from "./types.ts"

export interface AutoItem {
  id: string
  title: string
  subtitle?: string
  browsable?: boolean
}

// Keep each Binder response small. Larger collections remain accessible through pages.
const PAGE_SIZE = 80
export const AUTO_ROOT: AutoItem[] = [
  { id: "queue", title: "Cola de reproducción", browsable: true },
  { id: "favorites", title: "Favoritos", browsable: true },
  { id: "playlists", title: "Playlists", browsable: true },
]

function pageId(parent: string, offset: number) {
  return `page:${JSON.stringify([parent, offset])}`
}

function parsePage(id: string): [string, number] {
  if (!id.startsWith("page:")) return [id, 0]
  const value: unknown = JSON.parse(id.slice(5))
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" ||
    !Number.isSafeInteger(value[1]) || value[1] < 0 || value[0].startsWith("page:")) throw new Error("Página no válida")
  return [value[0], value[1]]
}

async function collection(provider: MusicProvider, queue: Track[], parent: string) {
  if (parent === "queue") return { tracks: queue, label: "Cola de reproducción" }
  if (parent === "favorites") return { tracks: (await provider.getStarred()).tracks, label: "Favoritos" }
  if (parent.startsWith("playlist:")) {
    const playlist = await provider.getPlaylist(parent.slice(9))
    return { tracks: playlist.tracks ?? [], label: playlist.name }
  }
  throw new Error("Colección no disponible")
}

export async function browseAuto(provider: MusicProvider, queue: Track[], id: string): Promise<AutoItem[]> {
  if (id === "root") return AUTO_ROOT
  const [parent, offset] = parsePage(id)
  let items: AutoItem[]
  let total: number
  if (parent === "playlists") {
    const playlists = await provider.getPlaylists()
    total = playlists.length
    items = playlists.slice(offset, offset + PAGE_SIZE).map((p) => ({
      id: `playlist:${p.id}`, title: p.name, subtitle: `${p.songCount} canciones`, browsable: true,
    }))
  } else {
    const { tracks } = await collection(provider, queue, parent)
    total = tracks.length
    items = tracks.slice(offset, offset + PAGE_SIZE).map((t, i) => ({
      // Include identity as well as position: an old car screen must never play a different song after a reorder.
      id: `track:${JSON.stringify([parent, t.id, offset + i])}`, title: t.title, subtitle: t.artist,
    }))
  }
  if (offset + PAGE_SIZE < total) items.push({
    id: pageId(parent, offset + PAGE_SIZE), title: parent === "playlists" ? "Más playlists" : "Más canciones", browsable: true,
  })
  return items.map((item) => ({ ...item, title: item.title.slice(0, 200), subtitle: item.subtitle?.slice(0, 200) }))
}

export async function resolveAutoPlay(provider: MusicProvider, queue: Track[], id: string) {
  if (!id.startsWith("track:")) throw new Error("Selecciona una canción")
  const value: unknown = JSON.parse(id.slice(6))
  if (!Array.isArray(value) || value.length !== 3 || typeof value[0] !== "string" ||
    typeof value[1] !== "string" || !Number.isSafeInteger(value[2]) || value[2] < 0) throw new Error("Canción no válida")
  const [parent, trackId, originalIndex] = value as [string, string, number]
  const { tracks, label } = await collection(provider, queue, parent)
  const index = tracks[originalIndex]?.id === trackId ? originalIndex : tracks.findIndex((t) => t.id === trackId)
  if (index < 0) throw new Error("La canción ya no está en esta colección")
  return { tracks, index, label, inQueue: parent === "queue" }
}

export async function searchAuto(provider: MusicProvider, queue: Track[], query: string) {
  const tracks = query.trim()
    ? (await provider.search(query.trim().slice(0, 200), undefined, "tracks")).tracks
    : queue.length ? queue : (await provider.getStarred()).tracks
  if (!tracks.length) throw new Error("No se encontraron canciones")
  return { tracks, index: 0, label: query.trim() ? `Búsqueda: ${query.trim()}` : queue.length ? "Cola de reproducción" : "Favoritos" }
}
