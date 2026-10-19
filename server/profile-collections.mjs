/**
 * Albums, artists and Home shelves of one profile, built from that profile's own listening history and
 * likes. The YouTube service keeps a single legacy library (every song streamed on the server, by anyone);
 * with profiles those views must never come from it, or every profile shows the same albums and artists.
 */
const parse = (json) => { try { return JSON.parse(json) } catch { return null } }

const shuffle = (list) => {
  for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]] }
  return list
}

export function profileCollections(db, userId, src = "ytdlp") {
  const entries = new Map()
  const add = (track, at, played) => {
    if (!track || typeof track.id !== "string" || typeof track.albumId !== "string") return
    const entry = entries.get(track.id) ?? { track, addedAt: at, lastPlayed: 0, plays: 0 }
    entry.addedAt = Math.min(entry.addedAt, at)
    if (played) { entry.lastPlayed = Math.max(entry.lastPlayed, at); entry.plays++ }
    entries.set(track.id, entry)
  }
  for (const row of db.prepare("SELECT track_json, played_at FROM history WHERE user_id = ? AND source = ?").all(userId, src)) add(parse(row.track_json), row.played_at, true)
  const liked = { album: [], artist: [] }
  for (const row of db.prepare("SELECT kind, item_json, created_at FROM likes WHERE user_id = ? AND source = ?").all(userId, src)) {
    const value = parse(row.item_json)
    if (!value || typeof value.id !== "string") continue
    if (row.kind === "track") add({ ...value, starred: undefined }, row.created_at, false)
    else if (liked[row.kind]) liked[row.kind].push({ value, at: row.created_at })
  }

  const albumList = () => {
    const groups = new Map()
    for (const entry of [...entries.values()].sort((a, b) => (a.track.track ?? 0) - (b.track.track ?? 0))) {
      const { track } = entry
      const group = groups.get(track.albumId) ?? { songs: [], addedAt: 0, lastPlayed: 0, plays: 0 }
      group.songs.push(track)
      group.addedAt = Math.max(group.addedAt, entry.addedAt)
      group.lastPlayed = Math.max(group.lastPlayed, entry.lastPlayed)
      group.plays += entry.plays
      groups.set(track.albumId, group)
    }
    const albums = [...groups.values()].map(({ songs, addedAt, lastPlayed, plays }) => {
      const first = songs[0]
      return {
        album: { id: first.albumId, name: first.album, artist: first.artist, artistId: first.artistId, coverArt: first.coverArt, year: first.year, songCount: songs.length, duration: songs.reduce((sum, song) => sum + (song.duration || 0), 0), tracks: songs },
        addedAt, lastPlayed, plays,
      }
    })
    const known = new Set(albums.map((a) => a.album.id))
    for (const { value, at } of liked.album) if (!known.has(value.id)) albums.push({ album: { ...value, starred: undefined }, addedAt: at, lastPlayed: 0, plays: 0 })
    return albums
  }

  const collections = {
    albums(type = "alphabeticalByName") {
      const list = albumList()
      if (type === "recent") list.sort((a, b) => b.lastPlayed - a.lastPlayed)
      else if (type === "frequent") list.sort((a, b) => b.plays - a.plays)
      else if (type === "newest") list.sort((a, b) => b.addedAt - a.addedAt)
      else if (type === "random") shuffle(list)
      else list.sort((a, b) => String(a.album.name).localeCompare(String(b.album.name)))
      return (type === "recent" ? list.filter((a) => a.lastPlayed > 0) : type === "frequent" ? list.filter((a) => a.plays > 0) : list).map((a) => a.album)
    },
    artists() {
      const albums = collections.albums()
      const byId = new Map()
      for (const { track } of entries.values()) {
        if (typeof track.artistId !== "string") continue
        const artist = byId.get(track.artistId) ?? { id: track.artistId, name: track.artist, coverArt: track.coverArt, topTracks: [] }
        artist.topTracks.push(track)
        byId.set(track.artistId, artist)
      }
      const result = [...byId.values()].map((artist) => {
        const own = albums.filter((album) => album.artistId === artist.id)
        return { ...artist, albumCount: own.length, albums: own }
      })
      const known = new Set(result.map((a) => a.id))
      for (const { value } of liked.artist) if (!known.has(value.id)) result.push({ ...value, starred: undefined })
      return result
    },
    /** Home shelves: the profile's own albums and artists, plus the shared catalogue discovery. */
    home(discovery) {
      const merge = (first, second) => {
        const unique = new Map()
        for (const album of [...first, ...second]) if (album?.id && !unique.has(album.id)) unique.set(album.id, album)
        return [...unique.values()].slice(0, 12)
      }
      return {
        recent: collections.albums("recent").slice(0, 12),
        newest: merge(collections.albums("newest"), discovery?.newest ?? []),
        frequent: collections.albums("frequent").slice(0, 12),
        random: merge(discovery?.random ?? [], collections.albums("random")),
        artists: collections.artists().slice(0, 12),
        // Profile playlists come from /api/playlists; the legacy server lists are not the profile's.
        playlists: [],
      }
    },
  }
  return collections
}
