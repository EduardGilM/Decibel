import assert from "node:assert/strict"
import { test } from "node:test"
import { applyRecent, MAX_RECENT, migrationOps, parseRows, recentItem, tracksOf } from "../src/lib/recent-searches.ts"

const track = (id, extra = {}) => ({ id, title: `T ${id}`, artist: "A", album: "B", coverArt: `c/${id}`, duration: 1, starred: true, replayGain: { trackGain: 1 }, ...extra })
let n = 0
const add = (id, at) => ({ n: ++n, op: "add", kind: "track", item: recentItem(track(id)), at })

test("applyRecent: newest first, a repeated search moves up, never twice, bounded", () => {
  const rows = applyRecent([], [add("a", 1), add("b", 2), add("a", 3)])
  assert.deepEqual(tracksOf(rows).map((t) => t.id), ["a", "b"])
  const many = applyRecent([], Array.from({ length: MAX_RECENT + 3 }, (_, i) => add(`x${i}`, i + 1)))
  assert.equal(many.length, MAX_RECENT)
  assert.equal(many[0].item.id, `x${MAX_RECENT + 2}`)
})

test("applyRecent: remove and clear only drop what was searched before them", () => {
  const rows = applyRecent([], [add("a", 1), add("b", 2)])
  assert.deepEqual(tracksOf(applyRecent(rows, [{ n: ++n, op: "remove", kind: "track", id: "a", at: 5 }])).map((t) => t.id), ["b"])
  assert.deepEqual(tracksOf(applyRecent(rows, [{ n: ++n, op: "clear", at: 1 }])).map((t) => t.id), ["b"])
  assert.deepEqual(applyRecent(rows, [{ n: ++n, op: "clear", at: 9 }]), [])
})

test("recentItem keeps what the dropdown paints (cover, artists, album) and drops per-device state", () => {
  const item = recentItem(track("a", { artists: [{ id: "ar", name: "A" }], albumId: "al" }))
  assert.equal(item.coverArt, "c/a")
  assert.deepEqual(item.artists, [{ id: "ar", name: "A" }])
  assert.equal(item.albumId, "al")
  assert.equal(item.starred, undefined)
  assert.equal(item.replayGain, undefined)
})

test("migrationOps uploads the old local list once, in the same order", () => {
  let seq = 100
  const ops = migrationOps([track("new"), track("mid"), track("old")], 1000, () => ++seq)
  assert.deepEqual(tracksOf(applyRecent([], ops)).map((t) => t.id), ["new", "mid", "old"])
  assert.ok(ops.every((op) => op.op === "add" && op.at < 1000))
  assert.equal(new Set(ops.map((op) => op.n)).size, 3)
})

test("parseRows ignores malformed server rows", () => {
  assert.deepEqual(parseRows(null), [])
  assert.equal(parseRows([{ kind: "track", item: track("a"), at: 1 }, { kind: "track", item: {}, at: 1 }, { kind: "track", at: 2 }]).length, 1)
})
