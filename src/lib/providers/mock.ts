import type { Album, Artist, Genre, HomeData, MusicProvider, Playlist, Starred, Track } from "@/lib/types"
import { addToLocalPlaylist, createLocalPlaylist, loadLocalPlaylists, mergeLocalPlaylists, saveLocalPlaylists, withLocalAdditions } from "@/lib/local-playlists"
import { generateTrackWav, hash, rng } from "./mock-audio"

// Flat palette (Trace Style: solid colours, no gradients).
const PALETTE = ["#1f6f5c", "#7a3b69", "#2b4c7e", "#a4502c", "#5b5f97", "#3d6b35", "#8c6d1f", "#6b2737", "#22577a", "#4a4e69", "#7f5539", "#386641"]

const ARTISTS = [
  ["Luna Arcade", ["Neón Lento", "Ciudades de Papel"]],
  ["Los Faros", ["Marea Alta", "Puerto Norte"]],
  ["Clara Vidal", ["Habitación 12"]],
  ["Delta Sur", ["Kilómetro Cero", "Desierto Azul"]],
  ["Mira Okafor", ["Soft Machines"]],
  ["Bruma", ["Niebla", "Bajo Cero"]],
  ["Nodo", ["Señal / Ruido"]],
  ["Aurora Dey", ["Late Bloom"]],
] as const

const WORDS = ["Noche", "Eco", "Sal", "Ventana", "Brillo", "Cometa", "Ruta", "Calma", "Fuego", "Origen", "Río", "Pulso", "Sombra", "Verano", "Espejo", "Vuelo", "Hilo", "Cristal", "Lluvia", "Raíz", "Faro", "Norte", "Ámbar", "Mareas"]
const GENRES = ["Indie", "Electrónica", "Pop", "Rock", "Lo-fi", "Ambient", "Jazz", "Hip-hop"]

function coverSvg(seed: string, color: string, label: string) {
  const r = rng(hash(seed))
  const shapes: string[] = []
  const kind = Math.floor(r() * 3)
  for (let i = 0; i < 4; i++) {
    const x = Math.round(r() * 300)
    const y = Math.round(r() * 300)
    const s = 40 + Math.round(r() * 140)
    const op = (0.12 + r() * 0.22).toFixed(2)
    if (kind === 0) shapes.push(`<circle cx="${x}" cy="${y}" r="${s / 2}" fill="#fff" fill-opacity="${op}"/>`)
    else if (kind === 1) shapes.push(`<rect x="${x - s / 2}" y="${y - s / 2}" width="${s}" height="${s}" fill="#000" fill-opacity="${op}"/>`)
    else shapes.push(`<rect x="0" y="${y}" width="300" height="${Math.round(s / 6)}" fill="#fff" fill-opacity="${op}"/>`)
  }
  const text = label.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><rect width="300" height="300" fill="${color}"/>${shapes.join("")}<text x="20" y="276" font-family="system-ui,sans-serif" font-size="26" font-weight="600" fill="#fff">${text}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

interface Db {
  artists: Artist[]
  albums: Album[]
  tracks: Track[]
  playlists: Playlist[]
  covers: Map<string, string>
  colors: Map<string, string>
  starred: Set<string>
}

function buildDb(): Db {
  const r = rng(42)
  const covers = new Map<string, string>()
  const colors = new Map<string, string>()
  const artists: Artist[] = []
  const albums: Album[] = []
  const tracks: Track[] = []
  let colorIdx = 0
  ARTISTS.forEach(([name, albumNames], ai) => {
    const artistId = `ar-${ai}`
    const color = PALETTE[(ai * 5) % PALETTE.length]
    covers.set(artistId, coverSvg(artistId, color, name))
    const artist: Artist = { id: artistId, name, coverArt: artistId, albumCount: albumNames.length, color, albums: [] }
    albumNames.forEach((albumName, bi) => {
      const albumId = `al-${ai}-${bi}`
      const albumColor = PALETTE[colorIdx++ % PALETTE.length]
      covers.set(albumId, coverSvg(albumId, albumColor, albumName))
      const count = 5 + Math.floor(r() * 6)
      const albumTracks: Track[] = []
      for (let t = 0; t < count; t++) {
        const w1 = WORDS[Math.floor(r() * WORDS.length)]
        const w2 = WORDS[Math.floor(r() * WORDS.length)]
        const title = r() > 0.5 ? `${w1} de ${w2.toLowerCase()}` : w1 === w2 ? w1 : `${w1} ${w2.toLowerCase()}`
        const track: Track = {
          id: `tr-${ai}-${bi}-${t}`,
          title,
          artist: name,
          artistId,
          album: albumName,
          albumId,
          coverArt: albumId,
          duration: 28 + Math.floor(r() * 40),
          track: t + 1,
          year: 2014 + Math.floor(r() * 12),
        }
        albumTracks.push(track)
        tracks.push(track)
      }
      const album: Album = {
        id: albumId,
        name: albumName,
        artist: name,
        artistId,
        coverArt: albumId,
        year: albumTracks[0].year,
        songCount: count,
        duration: albumTracks.reduce((a, b) => a + b.duration, 0),
        genre: GENRES[Math.floor(r() * GENRES.length)],
        color: albumColor,
        tracks: albumTracks,
      }
      albums.push(album)
      artist.albums!.push(album)
    })
    artists.push(artist)
  })

  const pick = (n: number) => Array.from({ length: n }, () => tracks[Math.floor(r() * tracks.length)]).filter((t, i, a) => a.indexOf(t) === i)
  const playlists: Playlist[] = [
    ["Para concentrarse", "Instrumental y tranquilo"],
    ["Mañanas", "Para empezar el día"],
    ["Carretera", "Kilómetros y kilómetros"],
    ["Favoritas 2026", "Lo más escuchado del año"],
    ["Noche", "Bajando revoluciones"],
    ["Descubrimientos", "Cosas nuevas"],
  ].map(([name, comment], i) => {
    const id = `pl-${i}`
    const color = PALETTE[(i * 3 + 1) % PALETTE.length]
    covers.set(id, coverSvg(id, color, name))
    const pt = pick(8 + Math.floor(r() * 10))
    return { id, name, comment, owner: "demo", coverArt: id, color, songCount: pt.length, duration: pt.reduce((a, b) => a + b.duration, 0), tracks: pt }
  })

  const starred = new Set<string>(pick(12).map((t) => t.id))
  starred.add(albums[0].id)
  starred.add(artists[1].id)
  for (const a of albums) colors.set(a.id, a.color!)
  for (const a of artists) colors.set(a.id, a.color!)
  for (const p of playlists) colors.set(p.id, p.color!)
  return { artists, albums, tracks, playlists, covers, colors, starred }
}

/** Case- and accent-insensitive matching: "Introducción" ≈ "introduccion". */
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")

let db: Db | null = null
const getDb = () => (db ??= buildDb())
const delay = <T,>(v: T, ms = 120) => new Promise<T>((res) => setTimeout(() => res(v), ms))

function withStar<T extends { id: string; starred?: boolean }>(item: T): T {
  return { ...item, starred: getDb().starred.has(item.id) }
}

/** Demo lists live on this device (localStorage); the built-in ones accept extra songs too. */
const localStore = () => (typeof window === "undefined" ? undefined : window.localStorage)
const localPlaylists = () => loadLocalPlaylists(localStore())
const playlistsChanged = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("decibel:data-changed")) }

function shuffled<T>(arr: T[], seed: number) {
  const r = rng(seed)
  return [...arr].sort(() => r() - 0.5)
}

export class MockProvider implements MusicProvider {
  readonly kind = "mock" as const

  async ping() {
    await delay(null)
  }

  async getHome(): Promise<HomeData> {
    const d = getDb()
    return delay({
      recent: shuffled(d.albums, 1).slice(0, 8),
      newest: [...d.albums].sort((a, b) => (b.year ?? 0) - (a.year ?? 0)).slice(0, 8),
      frequent: shuffled(d.albums, 7).slice(0, 8),
      random: shuffled(d.albums, Date.now() % 1000).slice(0, 8),
      playlists: mergeLocalPlaylists(localPlaylists(), d.playlists),
      artists: d.artists,
    })
  }

  async getAlbum(id: string) {
    const a = getDb().albums.find((x) => x.id === id)
    if (!a) throw new Error("Álbum no encontrado")
    return delay({ ...withStar(a), tracks: a.tracks!.map(withStar) })
  }

  async getArtist(id: string) {
    const a = getDb().artists.find((x) => x.id === id)
    if (!a) throw new Error("Artista no encontrado")
    const all = a.albums!.flatMap((al) => al.tracks!)
    return delay({ ...withStar(a), topTracks: shuffled(all, hash(id)).slice(0, 5).map(withStar) })
  }

  async getArtists() {
    return delay(getDb().artists)
  }

  async getAlbums(type: "newest" | "recent" | "frequent" | "random" | "alphabeticalByName" = "alphabeticalByName") {
    const d = getDb()
    if (type === "alphabeticalByName") return delay([...d.albums].sort((a, b) => a.name.localeCompare(b.name)))
    return delay(shuffled(d.albums, hash(type)))
  }

  async getPlaylists() {
    return delay(mergeLocalPlaylists(localPlaylists(), getDb().playlists))
  }

  async getPlaylist(id: string) {
    const state = localPlaylists()
    const builtIn = getDb().playlists.find((x) => x.id === id)
    const p = state.created.find((x) => x.id === id) ?? (builtIn && withLocalAdditions(state, builtIn))
    if (!p) throw new Error("Playlist no encontrada")
    return delay({ ...p, tracks: (p.tracks ?? []).map(withStar) })
  }

  async createPlaylist(name: string, track?: Track) {
    const id = `loc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const { state, playlist } = createLocalPlaylist(localPlaylists(), name, track, id)
    saveLocalPlaylists(localStore(), state)
    playlistsChanged()
    return delay(playlist, 60)
  }

  async addToPlaylist(id: string, track: Track) {
    const current = localPlaylists()
    const { state, playlist, duplicate } = addToLocalPlaylist(current, getDb().playlists.find((x) => x.id === id), id, track)
    if (!duplicate) { saveLocalPlaylists(localStore(), state); playlistsChanged() }
    return delay(playlist, 60)
  }

  async getStarred(): Promise<Starred> {
    const d = getDb()
    return delay({
      tracks: d.tracks.filter((t) => d.starred.has(t.id)).map(withStar),
      albums: d.albums.filter((a) => d.starred.has(a.id)).map(withStar),
      artists: d.artists.filter((a) => d.starred.has(a.id)).map(withStar),
    })
  }

  async getGenres(): Promise<Genre[]> {
    const d = getDb()
    return delay(
      GENRES.map((name) => {
        const al = d.albums.filter((a) => a.genre === name)
        return { name, albumCount: al.length, songCount: al.reduce((a, b) => a + b.songCount, 0) }
      }),
    )
  }

  async search(query: string) {
    const q = fold(query)
    const d = getDb()
    if (!q) return { artists: [], albums: [], tracks: [] }
    const has = (...fields: (string | undefined)[]) => fields.some((f) => f && fold(f).includes(q))
    return delay({
      artists: d.artists.filter((a) => has(a.name)),
      albums: d.albums.filter((a) => has(a.name, a.artist, a.genre)),
      tracks: d.tracks.filter((t) => has(t.title, t.artist, t.album)).slice(0, 30).map(withStar),
    })
  }

  async star(id: string) {
    getDb().starred.add(id)
  }

  async unstar(id: string) {
    getDb().starred.delete(id)
  }

  coverUrl(coverArt?: string) {
    if (!coverArt) return undefined
    return getDb().covers.get(coverArt)
  }

  coverColor(coverArt?: string) {
    return coverArt ? getDb().colors.get(coverArt) : undefined
  }

  async streamUrl(track: Track) {
    return generateTrackWav(track.id, track.duration)
  }
}
