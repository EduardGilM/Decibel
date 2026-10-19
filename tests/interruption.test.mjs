import assert from "node:assert/strict"
import { test } from "node:test"
import { createInterruption } from "../src/lib/audio/interruption.ts"

function setup({ playing = true } = {}) {
  const el = { volume: 0.9, paused: !playing }
  const state = { playing, calls: [] }
  let time = 0
  const it = createInterruption({
    audio: () => el,
    playing: () => state.playing,
    setPlaying: (v) => { state.calls.push(v); state.playing = v; el.paused = !v },
    now: () => time,
    wait: async () => {},
  })
  return { el, state, it, advance: (ms) => { time += ms } }
}

test("an interruption fades out and pauses, then fades back in to the same level", async () => {
  const { el, state, it } = setup()
  await it.begin()
  assert.deepEqual(state.calls, [false])
  assert.equal(el.volume, 0.9, "the level is restored for the next play")
  await it.end()
  assert.deepEqual(state.calls, [false, true])
  assert.equal(el.volume, 0.9)
})

test("a pause the user makes during the interruption is respected: no auto-resume", async () => {
  const { state, it } = setup()
  await it.begin()
  it.userAction()
  await it.end()
  assert.deepEqual(state.calls, [false])
})

test("music that was not playing never starts when the interruption ends", async () => {
  const { state, it } = setup({ playing: false })
  await it.begin()
  await it.end()
  assert.deepEqual(state.calls, [])
})

test("a pause the WebView made on focus loss counts as the interruption's and resumes after it", async () => {
  const { state, it, advance, el } = setup({ playing: false })
  it.systemPaused()
  advance(500)
  await it.begin()
  await it.end()
  assert.deepEqual(state.calls, [true])
  assert.equal(el.volume, 0.9)
  const late = setup({ playing: false })
  late.it.systemPaused()
  late.advance(10_000)
  await late.it.begin()
  await late.it.end()
  assert.deepEqual(late.state.calls, [], "an old pause is the user's")
})

test("the WebView pausing in the middle of our fade is still the interruption's pause", async () => {
  const { state, it } = setup()
  const begun = it.begin()
  // The store change it causes notifies subscribers synchronously, inside systemPaused: not the user's.
  it.systemPaused(() => { state.playing = false; it.userAction() })
  await begun
  await it.end()
  assert.equal(state.calls.at(-1), true)
})
