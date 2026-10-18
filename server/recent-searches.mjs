import { transaction } from "./db.mjs"
import { MusicError } from "./errors.mjs"
import { source } from "./library.mjs"

/**
 * Recent searches of the search dropdown, per profile and source, so every device of a profile sees the
 * same list. Clients send operations with the time they happened (they queue them while offline):
 * - add: the entry goes (back) to the top; the same kind + id never appears twice;
 * - remove: drops that entry unless it was searched again later (on any device), and remembers when;
 * - clear: drops everything searched before that moment.
 * Applying operations in any order converges, so a late offline queue cannot resurrect what another device
 * deleted afterwards, nor delete what was searched afterwards. At most MAX entries are kept.
 */
export const MAX_RECENT = 20
export const RECENT_KINDS = ["track", "album", "artist", "query"]
const MAX_JSON = 8_000
const MAX_OPS = 200

function entry(kind, value) {
  if (!RECENT_KINDS.includes(kind)) throw new MusicError("Tipo de búsqueda no válido.")
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !value.id || value.id.length > 300) throw new MusicError("La búsqueda no es válida.")
  const json = JSON.stringify(value)
  if (json.length > MAX_JSON) throw new MusicError("La búsqueda es demasiado grande.")
  return json
}

const parse = (json) => { try { return JSON.parse(json) } catch { return null } }

export function createRecentSearches(db, { now = () => Date.now() } = {}) {
  // Times from clients: never in the future (a wrong clock must not pin an entry on top forever).
  const when = (at) => { const t = Number(at); const limit = now(); return Number.isFinite(t) && t > 0 ? Math.round(Math.min(t, limit)) : limit }
  const clearedAt = (userId, src) => db.prepare("SELECT cleared_at FROM recent_searches_cleared WHERE user_id = ? AND source = ?").get(userId, src)?.cleared_at ?? 0

  const ops = {
    add(userId, src, { kind, item, at }) {
      const json = entry(kind, item)
      const t = when(at)
      if (t <= clearedAt(userId, src)) return // searched before a later «clear all»
      const removed = db.prepare("SELECT removed_at FROM recent_searches_removed WHERE user_id = ? AND source = ? AND kind = ? AND item_id = ?").get(userId, src, kind, item.id)
      if (removed && t <= removed.removed_at) return // searched before a later delete of this entry
      db.prepare(`INSERT INTO recent_searches (user_id, source, kind, item_id, item_json, searched_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT DO UPDATE SET item_json = CASE WHEN excluded.searched_at >= searched_at THEN excluded.item_json ELSE item_json END,
        searched_at = MAX(searched_at, excluded.searched_at)`).run(userId, src, kind, item.id, json, t)
    },
    remove(userId, src, { kind, id, at }) {
      if (!RECENT_KINDS.includes(kind) || typeof id !== "string") throw new MusicError("La búsqueda no es válida.")
      const t = when(at)
      db.prepare("DELETE FROM recent_searches WHERE user_id = ? AND source = ? AND kind = ? AND item_id = ? AND searched_at <= ?").run(userId, src, kind, id, t)
      db.prepare(`INSERT INTO recent_searches_removed (user_id, source, kind, item_id, removed_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT DO UPDATE SET removed_at = MAX(removed_at, excluded.removed_at)`).run(userId, src, kind, id, t)
    },
    clear(userId, src, { at }) {
      const t = when(at)
      db.prepare("DELETE FROM recent_searches WHERE user_id = ? AND source = ? AND searched_at <= ?").run(userId, src, t)
      db.prepare("INSERT INTO recent_searches_cleared (user_id, source, cleared_at) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET cleared_at = MAX(cleared_at, excluded.cleared_at)").run(userId, src, t)
    },
  }
  // Delete markers only matter for queues still in flight: keep the newest 200 per profile and source.
  const trimRemoved = (userId, src) => db.prepare(`DELETE FROM recent_searches_removed WHERE user_id = ? AND source = ? AND rowid NOT IN
    (SELECT rowid FROM recent_searches_removed WHERE user_id = ? AND source = ? ORDER BY removed_at DESC LIMIT 200)`).run(userId, src, userId, src)
  const trim = (userId, src) => db.prepare(`DELETE FROM recent_searches WHERE user_id = ? AND source = ? AND rowid NOT IN
    (SELECT rowid FROM recent_searches WHERE user_id = ? AND source = ? ORDER BY searched_at DESC LIMIT ${MAX_RECENT})`).run(userId, src, userId, src)

  const api = {
    list(userId, src) {
      return db.prepare(`SELECT kind, item_json, searched_at FROM recent_searches WHERE user_id = ? AND source = ? ORDER BY searched_at DESC LIMIT ${MAX_RECENT}`)
        .all(userId, source(src))
        .map((row) => ({ kind: row.kind, item: parse(row.item_json), at: row.searched_at }))
        .filter((row) => row.item)
    },
    /** Applies a batch of { op: "add" | "remove" | "clear", ... } atomically and returns the resulting list. */
    apply(userId, src, list) {
      const s = source(src)
      if (!Array.isArray(list) || list.length > MAX_OPS) throw new MusicError("Operaciones no válidas.")
      transaction(db, () => {
        for (const op of list) {
          if (!op || !Object.hasOwn(ops, op.op)) throw new MusicError("Operación no válida.")
          ops[op.op](userId, s, op)
        }
        trim(userId, s)
        trimRemoved(userId, s)
      })
      return api.list(userId, s)
    },
  }
  return api
}
