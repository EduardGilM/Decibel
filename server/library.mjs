import { randomUUID } from "node:crypto"
import { transaction } from "./db.mjs"
import { MusicError } from "./errors.mjs"

export const SOURCES = ["mock", "subsonic", "ytdlp"]
const KINDS = ["track", "album", "artist"]
const MAX_JSON = 16_000

export function source(value) {
  if (!SOURCES.includes(value)) throw new MusicError("Fuente no válida.")
  return value
}

function item(value, label = "elemento") {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id || value.id.length > 300) throw new MusicError(`El ${label} no es válido.`)
  const json = JSON.stringify(value)
  if (json.length > MAX_JSON) throw new MusicError(`El ${label} es demasiado grande.`)
  return json
}

const parse = (json) => { try { return JSON.parse(json) } catch { return null } }

/** Per-profile likes, history, settings and (shared) playlists. */
export function createLibrary(db, { now = () => Date.now() } = {}) {
  const lib = {
    // ---- likes ----
    likes(userId, src) {
      const out = { tracks: [], albums: [], artists: [] }
      for (const row of db.prepare("SELECT kind, item_json FROM likes WHERE user_id = ? AND source = ? ORDER BY created_at DESC").all(userId, source(src))) {
        const value = parse(row.item_json)
        if (value) out[`${row.kind}s`].push({ ...value, starred: true })
      }
      return out
    },
    like(userId, src, kind, value, at = now()) {
      if (!KINDS.includes(kind)) throw new MusicError("Tipo no válido.")
      const json = item(value)
      db.prepare("INSERT INTO likes (user_id, source, kind, item_id, item_json, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET item_json = excluded.item_json")
        .run(userId, source(src), kind, value.id, json, at)
    },
    unlike(userId, src, kind, id) {
      db.prepare("DELETE FROM likes WHERE user_id = ? AND source = ? AND kind = ? AND item_id = ?").run(userId, source(src), String(kind), String(id))
    },

    // ---- history ----
    history(userId, src, limit = 500) {
      return db.prepare("SELECT id, track_json, played_at, listened, source FROM history WHERE user_id = ? AND source = ? ORDER BY played_at DESC LIMIT ?")
        .all(userId, source(src), Math.max(1, Math.min(2000, Number(limit) || 500)))
        .map((row) => ({ id: `h${row.id}`, track: parse(row.track_json), playedAt: row.played_at, listened: row.listened, source: row.source }))
        .filter((entry) => entry.track)
    },
    addHistory(userId, src, { track, playedAt, listened }) {
      const json = item(track, "tema")
      const at = Number.isFinite(playedAt) ? Math.min(playedAt, now() + 60_000) : now()
      db.prepare("INSERT INTO history (user_id, source, track_id, track_json, played_at, listened) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET listened = MAX(listened, excluded.listened)")
        .run(userId, source(src), track.id, json, Math.round(at), Math.max(0, Math.round(Number(listened) || 0)))
      // Keep the table bounded per profile.
      db.prepare("DELETE FROM history WHERE user_id = ? AND id NOT IN (SELECT id FROM history WHERE user_id = ? ORDER BY played_at DESC LIMIT 5000)").run(userId, userId)
    },
    clearHistory: (userId, src) => db.prepare("DELETE FROM history WHERE user_id = ? AND source = ?").run(userId, source(src)),

    // ---- settings ----
    settings(userId) { const row = db.prepare("SELECT json FROM settings WHERE user_id = ?").get(userId); return row ? parse(row.json) ?? {} : {} },
    saveSettings(userId, value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new MusicError("Ajustes no válidos.")
      const json = JSON.stringify(value)
      if (json.length > MAX_JSON) throw new MusicError("Ajustes demasiado grandes.")
      db.prepare("INSERT INTO settings (user_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at").run(userId, json, now())
      return value
    },

    // ---- playlists ----
    /** owner | editor | viewer | null. Collaborative lists are editable by every profile. */
    role(userId, playlist) {
      if (!playlist) return null
      if (playlist.owner_id === userId) return "owner"
      const member = db.prepare("SELECT role FROM playlist_members WHERE playlist_id = ? AND user_id = ?").get(playlist.id, userId)
      if (playlist.collaborative) return "editor"
      return member?.role ?? null
    },
    access(userId, id, need = "viewer") {
      const playlist = db.prepare("SELECT * FROM playlists WHERE id = ?").get(String(id))
      const role = lib.role(userId, playlist)
      if (!role) throw new MusicError("Lista no encontrada.", 404)
      const rank = { viewer: 0, editor: 1, owner: 2 }
      if (rank[role] < rank[need]) throw new MusicError(need === "owner" ? "Solo la persona que creó la lista puede hacer esto." : "No tienes permiso para editar esta lista.", 403)
      return { playlist, role }
    },
    summary(userId, playlist) {
      const stats = db.prepare("SELECT COUNT(*) AS n FROM playlist_tracks WHERE playlist_id = ?").get(playlist.id)
      const tracks = db.prepare("SELECT track_json FROM playlist_tracks WHERE playlist_id = ? ORDER BY position").all(playlist.id).map((r) => parse(r.track_json)).filter(Boolean)
      const owner = db.prepare("SELECT username FROM users WHERE id = ?").get(playlist.owner_id)
      const members = db.prepare("SELECT m.user_id, m.role, u.username FROM playlist_members m JOIN users u ON u.id = m.user_id WHERE m.playlist_id = ? ORDER BY u.username").all(playlist.id)
      const role = lib.role(userId, playlist)
      return {
        id: playlist.id,
        name: playlist.name,
        source: playlist.source,
        songCount: stats.n,
        duration: tracks.reduce((sum, t) => sum + (Number(t.duration) || 0), 0),
        coverArt: tracks.find((t) => t.coverArt)?.coverArt,
        owner: owner?.username,
        ownerId: playlist.owner_id,
        collaborative: !!playlist.collaborative,
        shared: !!playlist.collaborative || members.length > 0,
        members: members.map((m) => ({ id: m.user_id, name: m.username, role: m.role })),
        role,
        editable: role === "owner" || role === "editor",
        rev: playlist.rev,
        updatedAt: playlist.updated_at,
      }
    },
    playlists(userId, src) {
      return db.prepare(`SELECT DISTINCT p.* FROM playlists p LEFT JOIN playlist_members m ON m.playlist_id = p.id AND m.user_id = ?
                         WHERE p.source = ? AND (p.owner_id = ? OR m.user_id IS NOT NULL OR p.collaborative = 1) ORDER BY p.updated_at DESC`)
        .all(userId, source(src), userId).map((p) => lib.summary(userId, p))
    },
    playlist(userId, id) {
      const { playlist } = lib.access(userId, id)
      const tracks = db.prepare("SELECT t.position, t.track_json, t.added_at, t.added_by, u.username FROM playlist_tracks t LEFT JOIN users u ON u.id = t.added_by WHERE t.playlist_id = ? ORDER BY t.position").all(playlist.id)
      return {
        ...lib.summary(userId, playlist),
        tracks: tracks.map((t) => ({ ...parse(t.track_json), addedBy: t.username ?? undefined, addedById: t.added_by ?? undefined, addedAt: t.added_at })).filter((t) => t.id),
      }
    },
    createPlaylist(userId, src, name, tracks = [], { at = now() } = {}) {
      const clean = typeof name === "string" ? name.trim().slice(0, 100) : ""
      if (!clean) throw new MusicError("Ponle un nombre a la lista.")
      const id = `pl-${randomUUID()}`
      transaction(db, () => {
        db.prepare("INSERT INTO playlists (id, owner_id, source, name, collaborative, rev, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, ?, ?)").run(id, userId, source(src), clean, at, at)
        tracks.forEach((track, i) => db.prepare("INSERT INTO playlist_tracks (playlist_id, position, track_id, track_json, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, i, track.id, item(track, "tema"), userId, at))
      })
      return lib.playlist(userId, id)
    },
    touch: (id) => db.prepare("UPDATE playlists SET rev = rev + 1, updated_at = ? WHERE id = ?").run(now(), id),
    addTrack(userId, id, track) {
      const { playlist } = lib.access(userId, id, "editor")
      const json = item(track, "tema")
      if (db.prepare("SELECT 1 FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?").get(playlist.id, track.id)) return { added: false, playlist: lib.playlist(userId, id) }
      const next = db.prepare("SELECT COALESCE(MAX(position) + 1, 0) AS p FROM playlist_tracks WHERE playlist_id = ?").get(playlist.id).p
      db.prepare("INSERT INTO playlist_tracks (playlist_id, position, track_id, track_json, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)").run(playlist.id, next, track.id, json, userId, now())
      lib.touch(playlist.id)
      return { added: true, playlist: lib.playlist(userId, id) }
    },
    renumber(id) {
      const rows = db.prepare("SELECT position FROM playlist_tracks WHERE playlist_id = ? ORDER BY position").all(id)
      // Two passes avoid PK collisions while compacting positions.
      rows.forEach((r, i) => db.prepare("UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND position = ?").run(-1 - i, id, r.position))
      rows.forEach((_, i) => db.prepare("UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND position = ?").run(i, id, -1 - i))
    },
    removeTrack(userId, id, trackId) {
      const { playlist } = lib.access(userId, id, "editor")
      transaction(db, () => {
        db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?").run(playlist.id, String(trackId))
        lib.renumber(playlist.id)
        lib.touch(playlist.id)
      })
      return lib.playlist(userId, id)
    },
    moveTrack(userId, id, from, to) {
      const { playlist } = lib.access(userId, id, "editor")
      transaction(db, () => {
        const rows = db.prepare("SELECT position, track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position").all(playlist.id)
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= rows.length || to >= rows.length) throw new MusicError("Posición no válida.")
        const order = rows.map((r) => r.position)
        const [moved] = order.splice(from, 1)
        order.splice(to, 0, moved)
        order.forEach((old, i) => db.prepare("UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND position = ?").run(-1 - i, playlist.id, old))
        order.forEach((_, i) => db.prepare("UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND position = ?").run(i, playlist.id, -1 - i))
        lib.touch(playlist.id)
      })
      return lib.playlist(userId, id)
    },
    updatePlaylist(userId, id, { name, collaborative }) {
      const { playlist } = lib.access(userId, id, "owner")
      if (name !== undefined) {
        const clean = typeof name === "string" ? name.trim().slice(0, 100) : ""
        if (!clean) throw new MusicError("Ponle un nombre a la lista.")
        db.prepare("UPDATE playlists SET name = ? WHERE id = ?").run(clean, playlist.id)
      }
      if (collaborative !== undefined) db.prepare("UPDATE playlists SET collaborative = ? WHERE id = ?").run(collaborative ? 1 : 0, playlist.id)
      lib.touch(playlist.id)
      return lib.playlist(userId, id)
    },
    deletePlaylist(userId, id) {
      const { playlist } = lib.access(userId, id, "owner")
      db.prepare("DELETE FROM playlists WHERE id = ?").run(playlist.id)
    },
    setMember(userId, id, memberId, role) {
      const { playlist } = lib.access(userId, id, "owner")
      if (memberId === playlist.owner_id) throw new MusicError("La persona que creó la lista ya tiene acceso.")
      if (!db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1").get(String(memberId))) throw new MusicError("Perfil no encontrado.", 404)
      if (role === null || role === "none") db.prepare("DELETE FROM playlist_members WHERE playlist_id = ? AND user_id = ?").run(playlist.id, memberId)
      else if (role === "viewer" || role === "editor") db.prepare("INSERT INTO playlist_members (playlist_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET role = excluded.role").run(playlist.id, memberId, role)
      else throw new MusicError("Rol no válido.")
      lib.touch(playlist.id)
      return lib.playlist(userId, id)
    },
    /** Members can leave a list shared with them. */
    leave(userId, id) {
      const { playlist, role } = lib.access(userId, id)
      if (role === "owner") throw new MusicError("No puedes salir de tu propia lista.")
      db.prepare("DELETE FROM playlist_members WHERE playlist_id = ? AND user_id = ?").run(playlist.id, userId)
    },

    // ---- one-shot import of the data a device had before profiles existed ----
    import(userId, src, { likes = [], playlists = [], history = [], settings } = {}) {
      source(src)
      const counts = { likes: 0, playlists: 0, history: 0, settings: false }
      transaction(db, () => {
        for (const like of likes.slice(0, 5000)) {
          if (!KINDS.includes(like?.kind) || !like.item?.id) continue
          lib.like(userId, src, like.kind, like.item); counts.likes++
        }
        const existing = new Set(db.prepare("SELECT name FROM playlists WHERE owner_id = ? AND source = ?").all(userId, src).map((p) => p.name.toLowerCase()))
        for (const list of playlists.slice(0, 200)) {
          if (!list?.name || existing.has(String(list.name).trim().toLowerCase())) continue
          const tracks = (Array.isArray(list.tracks) ? list.tracks : []).filter((t) => t?.id).slice(0, 2000)
          const id = `pl-${randomUUID()}`, at = now()
          db.prepare("INSERT INTO playlists (id, owner_id, source, name, collaborative, rev, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, ?, ?)").run(id, userId, src, String(list.name).trim().slice(0, 100), at, at)
          const seen = new Set()
          tracks.filter((t) => !seen.has(t.id) && seen.add(t.id)).forEach((t, i) => db.prepare("INSERT INTO playlist_tracks (playlist_id, position, track_id, track_json, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, i, t.id, item(t, "tema"), userId, at))
          counts.playlists++
        }
        for (const entry of history.slice(0, 2000)) {
          if (!entry?.track?.id) continue
          lib.addHistory(userId, src, entry); counts.history++
        }
        if (settings && typeof settings === "object" && !Object.keys(lib.settings(userId)).length) { lib.saveSettings(userId, settings); counts.settings = true }
      })
      return counts
    },
  }
  return lib
}
