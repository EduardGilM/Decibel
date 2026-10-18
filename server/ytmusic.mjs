import { execFile } from "node:child_process"
import { MusicError } from "./errors.mjs"

export function catalogId(value, type) {
  const prefix = type === "album" ? "ytm-album:" : "ytm-artist:"
  const id = typeof value === "string" && value.startsWith(prefix) ? value.slice(prefix.length) : ""
  if (!/^[a-zA-Z0-9_-]{10,100}$/.test(id)) throw new MusicError(`El identificador de ${type === "album" ? "álbum" : "artista"} no es válido.`)
  return id
}

export function thumbnail(items) {
  return [...(items || [])].filter((item) => /^https:\/\//.test(item.url || ""))
    .sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url
}

export function playableSong(info) {
  return info && /^[a-zA-Z0-9_-]{11}$/.test(info.videoId) && info.isAvailable !== false && !info.is_live &&
    !["is_live", "is_upcoming", "post_live"].includes(info.live_status) &&
    !["private", "premium_only", "subscriber_only", "needs_auth", "unavailable"].includes(info.availability)
}

export function mapCatalogAlbum(info) {
  if (!info || !/^[a-zA-Z0-9_-]{10,100}$/.test(info.browseId || "") || !info.title) return undefined
  const artist = info.artists?.filter((item) => item.name).map((item) => item.name).join(", ") || info.artist || "YouTube Music"
  const firstArtist = info.artists?.find((item) => item.id)
  return {
    id: `ytm-album:${info.browseId}`, name: info.title, artist,
    artistId: firstArtist ? `ytm-artist:${firstArtist.id}` : undefined,
    coverArt: thumbnail(info.thumbnails), year: Number(info.year) || undefined,
    songCount: 0, duration: 0,
  }
}

/** Artist search uses artist; related artists use title; browse pages use name. */
export function mapCatalogArtist(info) {
  const name = info?.artist || info?.title || info?.name
  if (!info || !/^[a-zA-Z0-9_-]{10,100}$/.test(info.browseId || "") || typeof name !== "string" || !name.trim()) return undefined
  return { id: `ytm-artist:${info.browseId}`, name, coverArt: thumbnail(info.thumbnails) }
}

/** Public Music home mixes albums, songs, artists and unsupported playlists. */
export function mapHomeAlbums(rows) {
  const newest = new Map(), random = new Map()
  const albumId = (id) => typeof id === "string" && /^MPRE[a-zA-Z0-9_-]{6,96}$/.test(id)
  for (const row of Array.isArray(rows) ? rows : []) {
    for (const entry of Array.isArray(row?.contents) ? row.contents : []) {
      if (!entry || entry.isAvailable === false) continue
      if (albumId(entry.browseId)) {
        const album = mapCatalogAlbum(entry)
        if (album && !newest.has(album.id)) newest.set(album.id, album)
      } else if (playableSong(entry) && albumId(entry.album?.id)) {
        const album = mapCatalogAlbum({ ...entry, browseId: entry.album.id, title: entry.album.name })
        if (album && !random.has(album.id)) random.set(album.id, album)
      }
    }
  }
  return { newest: [...newest.values()].slice(0, 12), random: [...random.values()].slice(0, 12) }
}

export function mapCatalogTrack(info) {
  if (!playableSong(info)) throw new MusicError("Canción no disponible en YouTube Music.", 404)
  const artist = info.artists?.filter((item) => item.name).map((item) => item.name).join(", ") || info.artist || "YouTube"
  const firstArtist = info.artists?.find((item) => item.id)
  const album = typeof info.album === "object" && info.album ? info.album : { name: info.album }
  const rawDuration = info.duration_seconds ?? info.duration ?? info.length
  const duration = typeof rawDuration === "number" ? rawDuration : /^\d+(?::\d{2}){1,2}$/.test(rawDuration || "") ? rawDuration.split(":").reduce((time, part) => time * 60 + Number(part), 0) : 0
  return {
    id: `yt:${info.videoId}`, title: info.title || "Sin título", artist,
    artistId: firstArtist ? `ytm-artist:${firstArtist.id}` : `yt-artist:${artist}`,
    artists: info.artists?.filter((item) => typeof item?.name === "string" && item.name.trim()).map((item) => ({ name: item.name, ...(/^[a-zA-Z0-9_-]{10,100}$/.test(item.id || "") ? { id: `ytm-artist:${item.id}` } : {}) })),
    album: album.name || info.title || "YouTube",
    albumId: album.id ? `ytm-album:${album.id}` : `yt-album:${info.videoId}`,
    coverArt: thumbnail(info.thumbnails || info.thumbnail) || `https://i.ytimg.com/vi/${info.videoId}/hqdefault.jpg`,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    year: Number(info.year) || undefined,
    metadataSource: album.id || info.resultType === "song" ? "ytmusic" : undefined,
  }
}

export function createYtMusicRunner(python, script) {
  return (operation, value = "") => new Promise((resolve, reject) => {
    if (!["health", "home", "search", "searchAlbums", "searchArtists", "song", "album", "artist", "artistRadio", "artistSongs", "recommendations"].includes(operation)) {
      reject(new MusicError("Operación de catálogo no válida.")); return
    }
    if (operation === "artistSongs" && (typeof value !== "string" || !/^[a-zA-Z0-9_-]{10,200}$/.test(value))) {
      reject(new MusicError("El identificador de playlist del catálogo no es válido.")); return
    }
    execFile(python, ["-B", script, operation, value], {
      timeout: operation === "home" ? 6000 : 45_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        const setup = error.code === "ENOENT" || stderr.includes('"setup"') || stderr.includes("No module named")
        reject(new MusicError(setup ? "Falta YouTube Music en el servidor. Ejecuta npm run music:setup." : error.killed ? "YouTube Music ha tardado demasiado. Vuelve a intentarlo." : "No se pudo consultar YouTube Music. Vuelve a intentarlo.", 502))
      } else {
        try { resolve(JSON.parse(stdout)) } catch { reject(new MusicError("YouTube Music devolvió una respuesta no válida.", 502)) }
      }
    })
  })
}
