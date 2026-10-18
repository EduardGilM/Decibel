import assert from "node:assert/strict"
import test from "node:test"

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.window = { localStorage: globalThis.localStorage }
const { moveInQueue, usePlayer } = await import("../src/stores/player.ts")

test("moving queue items keeps the current song and mirrors original without shuffle", () => {
  const five = ["a", "b", "c", "d", "e"].map((id) => ({ id }))
  let r = moveInQueue(five, five, 2, 4, 0, false)
  assert.deepEqual(r.queue.map((t) => t.id), ["e", "a", "b", "c", "d"]); assert.equal(r.index, 3); assert.equal(r.original, r.queue)
  r = moveInQueue(five, five, 2, 0, 4, true)
  assert.equal(r.queue[r.index].id, "c"); assert.equal(r.original, five)
  r = moveInQueue(five, five, 2, 2, 4, false)
  assert.equal(r.index, 4)
  assert.equal(moveInQueue(five, five, 0, 1, 9, false).queue, five)
})

test("the store action reorders the live queue and keeps playing the same song", () => {
  const songs = ["a", "b", "c"].map((id) => ({ id, title: id, artist: "", album: "", duration: 1 }))
  usePlayer.getState().playList(songs, 1)
  usePlayer.getState().moveQueueItem(2, 0)
  assert.deepEqual(usePlayer.getState().queue.map((t) => t.id), ["c", "a", "b"])
  assert.equal(usePlayer.getState().current().id, "b")
})
