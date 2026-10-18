import assert from "node:assert/strict"
import { test } from "node:test"
import { MINI_SWIPE_RUBBER, miniNeighbors, miniSwipeDecision, miniSwipeOffset, springStep } from "../src/lib/mini-swipe.ts"

const t = (id) => ({ id: `yt:${id.padEnd(11, "x")}`, title: id, artist: "A", album: "B", duration: 200 })
const q = [t("a"), t("b"), t("c")]
const view = (extra) => ({ queue: q, index: 1, repeat: "off", position: 0, hasRecommendations: false, ...extra })

test("neighbours mirror next()/prev(): middle of the queue", () => {
  const { next, prev } = miniNeighbors(view())
  assert.equal(next.track.title, "c")
  assert.equal(prev.track.title, "a")
})

test("prev past 3 s restarts the current song, like the button", () => {
  const { prev } = miniNeighbors(view({ position: 4 }))
  assert.equal(prev.track.title, "b")
  assert.equal(prev.restart, true)
})

test("ends of the queue: nothing (bounce), wrap with repeat all, radio after a yt: song", () => {
  assert.equal(miniNeighbors(view({ index: 0 })).prev, null)
  assert.equal(miniNeighbors(view({ index: 2 })).next, null)
  assert.equal(miniNeighbors(view({ index: 2, repeat: "all" })).next.track.title, "a")
  assert.equal(miniNeighbors(view({ index: 0, repeat: "all" })).prev.track.title, "c")
  assert.deepEqual(miniNeighbors(view({ index: 2, hasRecommendations: true })).next, { radio: true })
  assert.equal(miniNeighbors(view({ index: 2, hasRecommendations: true, repeat: "one" })).next, null)
  assert.deepEqual(miniNeighbors(view({ queue: [], index: 0 })), { next: null, prev: null })
})

test("release: ~33% of the width or a quick flick commits; left is next, right is previous", () => {
  const base = { width: 300, velocity: 0, hasNext: true, hasPrev: true }
  assert.equal(miniSwipeDecision({ ...base, dx: -100 }), "next")
  assert.equal(miniSwipeDecision({ ...base, dx: 100 }), "prev")
  assert.equal(miniSwipeDecision({ ...base, dx: -90 }), null, "below the threshold it springs back")
  assert.equal(miniSwipeDecision({ ...base, dx: -40, velocity: -0.8 }), "next", "flick")
  assert.equal(miniSwipeDecision({ ...base, dx: -40, velocity: 0.8 }), null, "flick against the drag")
  assert.equal(miniSwipeDecision({ ...base, dx: -10, velocity: -2 }), null, "a jittery tap never skips")
  assert.equal(miniSwipeDecision({ ...base, dx: -200, hasNext: false }), null, "nothing next: bounce only")
  assert.equal(miniSwipeDecision({ ...base, dx: 200, hasPrev: false }), null)
})

test("towards an empty side the strip only rubber-bands", () => {
  assert.equal(miniSwipeOffset(-120, true, true), -120)
  assert.equal(miniSwipeOffset(-30, false, true), -10)
  assert.equal(miniSwipeOffset(-300, false, true), -MINI_SWIPE_RUBBER)
  assert.equal(miniSwipeOffset(300, true, false), MINI_SWIPE_RUBBER)
})

test("the spring settles on its target", () => {
  let x = -120, v = 0
  for (let i = 0; i < 120; i++) [x, v] = springStep(x, v, 0, 1 / 60)
  assert.ok(Math.abs(x) < 0.5 && Math.abs(v) < 5)
})
