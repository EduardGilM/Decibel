import assert from "node:assert/strict"
import test from "node:test"
import { accumulate, addEntry, groupByDay, listenThreshold, recentAlbums, shouldRecord, updateListened } from "../src/lib/listen-history.ts"

const song = (id, album = "al", duration = 200) => ({ id, title: id, artist: "A", album: `Album ${album}`, albumId: album, duration, starred: true })

test("a listen counts after 30 s, or half of a short song", () => {
  assert.equal(listenThreshold(200), 30)
  assert.equal(listenThreshold(40), 20)
  assert.equal(listenThreshold(0), 30)
  assert.equal(shouldRecord(29.9, 200), false)
  assert.equal(shouldRecord(30, 200), true)
  assert.equal(shouldRecord(20, 40), true)
})

test("only real playback accumulates: seeks, rewinds and pauses do not", () => {
  let heard = 0
  heard = accumulate(heard, 0, 0.25, true)
  heard = accumulate(heard, 0.25, 90, true) // seek forward
  heard = accumulate(heard, 90, 10, true) // seek back
  heard = accumulate(heard, 10, 10.5, false) // paused
  heard = accumulate(heard, 10, 10.25, true)
  assert.equal(heard, 0.5)
})

test("entries are newest first, capped, and do not freeze liked state", () => {
  let list = []
  for (let i = 0; i < 5; i++) list = addEntry(list, song(`t${i}`), 31, 1000 + i, 3)
  assert.deepEqual(list.map((e) => e.track.id), ["t4", "t3", "t2"])
  assert.equal(list[0].track.starred, undefined)
})

test("recent albums are unique, newest first, and skip tracks without album", () => {
  let list = []
  list = addEntry(list, song("a", "x"), 31, 1)
  list = addEntry(list, { ...song("b"), albumId: undefined }, 31, 2)
  list = addEntry(list, song("c", "y"), 31, 3)
  list = addEntry(list, song("d", "x"), 31, 4)
  assert.deepEqual(recentAlbums(list).map((a) => a.id), ["x", "y"])
})

test("history groups by Hoy / Ayer / date", () => {
  const now = new Date(2026, 9, 17, 12)
  const list = [{ playedAt: new Date(2026, 9, 17, 9).getTime() }, { playedAt: new Date(2026, 9, 16, 23).getTime() }, { playedAt: new Date(2026, 9, 10, 9).getTime() }]
  assert.deepEqual(groupByDay(list, now).map((g) => g.label).slice(0, 2), ["Hoy", "Ayer"])
  assert.equal(groupByDay(list, now).length, 3)
})

test("a recorded listen keeps growing while the same playback goes on, never shrinks", () => {
  let list = addEntry([], song("a"), 30, 1000)
  list = addEntry(list, song("b"), 31, 2000)
  const a = list[1].id
  const grown = updateListened(list, a, 184.6)
  assert.equal(grown[1].listened, 185)
  assert.equal(grown[0], list[0])
  assert.equal(updateListened(grown, a, 100), grown)
  assert.equal(updateListened(grown, "missing", 999), grown)
})
