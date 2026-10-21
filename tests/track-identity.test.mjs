import assert from "node:assert/strict"
import test from "node:test"
import { duplicateCount, findSameTrack, sameTrack } from "../src/lib/track-identity.ts"
import { addToLocalPlaylist } from "../src/lib/local-playlists.ts"

const search = { id: "yt:abc", title: "Nada que perder", artist: "Robe", duration: 370 }
const album = { id: "yt:xyz", title: "Nada Que Perder (Remastered)", artist: "Robe", artists: [{ name: "Robe" }], duration: 372 }

test("one song is the same across ids and sources: title (release noise aside), main artist, ±3 s", () => {
  assert.ok(sameTrack(search, album))
  assert.ok(sameTrack(search, { ...search, id: "nav:1", duration: 0 }) === false, "no duration, other id: not provable")
  assert.ok(sameTrack(search, { ...search }))
  assert.ok(!sameTrack(search, { ...album, duration: 377 }), "5 s longer is another cut")
  assert.ok(!sameTrack(search, { ...album, artist: "Extremoduro", artists: [{ name: "Extremoduro" }] }))
  assert.ok(!sameTrack(search, { ...album, title: "Nada que perder (Acústico)" }))
  assert.equal(findSameTrack([{ id: "a", title: "Otra", artist: "Robe", duration: 200 }, album], search), album)
  assert.equal(duplicateCount([search, { id: "a", title: "Otra", artist: "Robe", duration: 200 }, album, search]), 2)
})

test("local playlists do not add the same song twice from another source", () => {
  const base = { id: "pl1", name: "Hits", owner: "local", songCount: 1, duration: 370, tracks: [search], editable: true }
  const result = addToLocalPlaylist({ version: 1, created: [], added: {} }, base, "pl1", album)
  assert.equal(result.duplicate, true)
})

test("the playlist add endpoint is idempotent by song, on own and shared playlists", async () => {
  const { openDb } = await import("../server/db.mjs")
  const { createLibrary } = await import("../server/library.mjs")
  const db = openDb(":memory:")
  db.prepare("INSERT INTO users (id, username, role, password_hash, created_at) VALUES ('u1', 'Eduard', 'admin', 'x', 1), ('u2', 'Ana', 'user', 'x', 1)").run()
  const lib = createLibrary(db, { now: () => 2_000_000 })
  const list = lib.createPlaylist("u1", "ytdlp", "Hits Extremoduro", [search])
  assert.equal(lib.addTrack("u1", list.id, album).added, false)
  assert.equal(lib.addTrack("u1", list.id, search).added, false)
  assert.equal(lib.addTrack("u1", list.id, { id: "yt:other", title: "Salir", artist: "Extremoduro", duration: 250 }).added, true)
  db.prepare("UPDATE playlists SET collaborative = 1 WHERE id = ?").run(list.id)
  assert.equal(lib.addTrack("u2", list.id, { ...album, id: "nav:9" }).added, false)
  assert.equal(lib.playlist("u1", list.id).tracks.length, 2)
})
