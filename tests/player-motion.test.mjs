import assert from "node:assert/strict"
import test from "node:test"
import { coverExpansionFrames } from "../src/lib/player-motion.ts"
import { activeLyricsLine, centeredLyricsScroll, lyricsLineState, parseLrc } from "../src/lib/lyrics.ts"

test("artwork moves from the mini player to the full artwork using only compositor transforms", () => {
  const from = { left: 14, top: 780, width: 44, height: 44 }
  const to = { left: 50, top: 180, width: 320, height: 320 }
  const frames = coverExpansionFrames(from, to)
  assert.deepEqual(frames, [
    { transform: "translate3d(-36px, 600px, 0) scale(0.1375, 0.1375)" },
    { transform: "translate3d(0, 0, 0) scale(1, 1)" },
  ])
  assert.equal(coverExpansionFrames({ ...from, width: 0 }, to), null)
  assert.equal(coverExpansionFrames(from, { ...to, height: 0 }), null)
})

test("lyrics centre even an already visible line, below a floating header, and can seek backwards", () => {
  const viewport = { scrollTop: 200, viewportTop: 100, viewportHeight: 400, scrollHeight: 1600 }
  assert.equal(centeredLyricsScroll({ ...viewport, lineTop: 360, lineHeight: 40 }), 280)
  assert.equal(centeredLyricsScroll({ ...viewport, lineTop: 360, lineHeight: 40, headerHeight: 80 }), 240)
  assert.equal(centeredLyricsScroll({ ...viewport, lineTop: 220, lineHeight: 40 }), 140)
  assert.equal(centeredLyricsScroll({ ...viewport, lineTop: -500, lineHeight: 40 }), 0)
  assert.equal(centeredLyricsScroll({ ...viewport, lineTop: 1800, lineHeight: 40 }), 1200)
  assert.equal(centeredLyricsScroll({ ...viewport, scrollHeight: 200, lineTop: 120, lineHeight: 40 }), 0)
})

test("progressive lyrics distinguish past, current and future before playback, in gaps and after seeking", () => {
  const lines = parseLrc("[00:02]Primera\n[00:04]\n[00:06]Segunda")
  const statesAt = (position) => lines.map((_, index) => lyricsLineState(index, activeLyricsLine(lines, position)))
  assert.deepEqual(statesAt(0), ["future", "future", "future"])
  assert.deepEqual(statesAt(2), ["active", "future", "future"])
  assert.deepEqual(statesAt(5), ["past", "active", "future"])
  assert.deepEqual(statesAt(10), ["past", "past", "active"])
  assert.deepEqual(statesAt(3), ["active", "future", "future"])
})
test("preview lyrics keep the active line in the upper third and start at the top", () => {
  const viewport = { scrollTop: 200, viewportTop: 100, viewportHeight: 400, scrollHeight: 1600, headerHeight: 80 }
  assert.equal(centeredLyricsScroll({ ...viewport, lineTop: 360, lineHeight: 40, anchor: 0.3 }), 304)
  assert.equal(centeredLyricsScroll({ ...viewport, scrollTop: 0, lineTop: 150, lineHeight: 40, anchor: 0.3 }), 0)
})
