import assert from "node:assert/strict"
import test from "node:test"
import { addToLocalPlaylist, createLocalPlaylist, emptyLocalPlaylists, loadLocalPlaylists, mergeLocalPlaylists, saveLocalPlaylists } from "../src/lib/local-playlists.ts"

const song = (id, duration = 100) => ({ id, title: id, artist: "A", album: "B", duration, coverArt: `c-${id}`, starred: true })
const memory = () => { const map = new Map(); return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), map } }

test("creating a list trims the name, adds the first song and marks it editable", () => {
  const { state, playlist } = createLocalPlaylist(emptyLocalPlaylists(), "  Mi   lista ", song("a", 90), "loc-1")
  assert.equal(playlist.name, "Mi lista")
  assert.equal(playlist.editable, true)
  assert.equal(playlist.songCount, 1)
  assert.equal(playlist.duration, 90)
  assert.equal(playlist.coverArt, "c-a")
  assert.equal(playlist.tracks[0].starred, undefined, "liked state is not frozen into the list")
  assert.deepEqual(state.created.map((list) => list.id), ["loc-1"])
})

test("empty names are rejected", () => {
  assert.throws(() => createLocalPlaylist(emptyLocalPlaylists(), "   ", undefined, "x"), /nombre/)
})

test("adding to a device list appends once and reports duplicates", () => {
  let { state } = createLocalPlaylist(emptyLocalPlaylists(), "L", song("a"), "loc-1")
  const first = addToLocalPlaylist(state, undefined, "loc-1", song("b", 50))
  assert.equal(first.duplicate, false)
  assert.equal(first.playlist.songCount, 2)
  assert.equal(first.playlist.duration, 150)
  state = first.state
  const again = addToLocalPlaylist(state, undefined, "loc-1", song("b"))
  assert.equal(again.duplicate, true)
  assert.equal(again.state, state, "duplicates leave state untouched")
})

test("built-in lists keep their songs and gain device additions", () => {
  const builtIn = { id: "pl-0", name: "Demo", songCount: 1, duration: 100, tracks: [song("a")] }
  const dup = addToLocalPlaylist(emptyLocalPlaylists(), builtIn, "pl-0", song("a"))
  assert.equal(dup.duplicate, true)
  const { state, playlist } = addToLocalPlaylist(emptyLocalPlaylists(), builtIn, "pl-0", song("z", 20))
  assert.deepEqual(playlist.tracks.map((t) => t.id), ["a", "z"])
  assert.equal(playlist.songCount, 2)
  assert.equal(playlist.editable, true)
  const merged = mergeLocalPlaylists(createLocalPlaylist(state, "Nueva", undefined, "loc-9").state, [builtIn])
  assert.deepEqual(merged.map((list) => list.id), ["loc-9", "pl-0"])
  assert.equal(merged[1].songCount, 2)
  assert.throws(() => addToLocalPlaylist(emptyLocalPlaylists(), undefined, "missing", song("a")), /no encontrada/)
})

test("state survives a save/load round trip and corrupt storage falls back to empty", () => {
  const storage = memory()
  const { state } = createLocalPlaylist(emptyLocalPlaylists(), "L", song("a"), "loc-1")
  saveLocalPlaylists(storage, state)
  assert.deepEqual(loadLocalPlaylists(storage), state)
  storage.setItem("decibel-playlists", "{nope")
  assert.deepEqual(loadLocalPlaylists(storage), emptyLocalPlaylists())
  storage.setItem("decibel-playlists", JSON.stringify({ version: 2 }))
  assert.deepEqual(loadLocalPlaylists(storage), emptyLocalPlaylists())
  assert.deepEqual(loadLocalPlaylists(undefined), emptyLocalPlaylists())
})
