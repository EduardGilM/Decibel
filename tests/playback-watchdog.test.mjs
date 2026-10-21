import assert from "node:assert/strict"
import { test } from "node:test"
import { advanced, MAX_RETRIES, PlaybackWatchdog, STALL_TIMEOUT_MS } from "../src/lib/audio/watchdog.ts"

/** Drives a watchdog with 1 s ticks, like the engine's interval. */
function rig(extra = {}) {
  const dog = new PlaybackWatchdog(extra)
  const s = { now: 0, key: "1:yt:a", wantsPlaying: true, position: 0, resolved: false }
  const tick = (patch = {}, ms = 1000) => { Object.assign(s, patch); s.now += ms; return dog.sample({ ...s }) }
  const run = (seconds, patch) => { const out = []; for (let i = 0; i < seconds; i++) { const a = tick(patch); if (a) out.push({ at: s.now, ...a }) } return out }
  return { dog, s, tick, run }
}

test("a song that never starts: retry twice ~12 s apart, then skip", () => {
  const { run } = rig()
  run(1) // first sample registers the playback
  const actions = run(40)
  assert.deepEqual(actions.map((a) => a.type), ["retry", "retry", "skip"])
  assert.equal(actions[0].at - 1000, STALL_TIMEOUT_MS)
  assert.equal(actions[1].at - actions[0].at, STALL_TIMEOUT_MS)
  assert.equal(actions[2].at - actions[1].at, STALL_TIMEOUT_MS)
  assert.equal(MAX_RETRIES, 2)
})

test("URL still resolving: the retry joins the server's work (no refresh); stalled audio asks for a fresh URL", () => {
  const pending = rig()
  pending.run(1)
  assert.equal(pending.run(13)[0].refresh, false)
  const stalled = rig()
  stalled.run(1, { resolved: true })
  const [retry] = stalled.run(13)
  assert.equal(retry.refresh, true)
})

test("stall mid-song resumes where it stopped", () => {
  const { run } = rig()
  run(1, { resolved: true })
  for (let p = 1; p <= 30; p++) run(1, { position: p })
  const [retry] = run(13)
  assert.equal(retry.type, "retry")
  assert.equal(retry.resumeAt, 30)
})

test("normal playback and slow-but-moving buffering never trigger", () => {
  const { run } = rig()
  run(1, { resolved: true })
  const actions = []
  for (let p = 0; p < 120; p += 0.5) actions.push(...run(1, { position: p }))
  // 8 s of buffering, then moving again
  actions.push(...run(8), ...run(1, { position: 61 }))
  assert.deepEqual(actions, [])
})

test("paused (or waiting for radio) never counts, however long", () => {
  const { run } = rig()
  run(1)
  assert.deepEqual(run(120, { wantsPlaying: false }), [])
  // resuming starts the clock again
  assert.deepEqual(run(11, { wantsPlaying: true }), [])
  assert.equal(run(2)[0].type, "retry")
})

test("a new playback (next song, same song again) starts from scratch", () => {
  const { run } = rig()
  run(1)
  assert.equal(run(25).length, 2)
  assert.deepEqual(run(11, { key: "2:yt:b" }), [])
  const [first] = run(2)
  assert.equal(first.type, "retry")
  assert.equal(first.attempt, 1)
})

test("pressing play again after giving up refills the budget", () => {
  const { run } = rig()
  run(1)
  assert.deepEqual(run(37).map((a) => a.type), ["retry", "retry", "skip"])
  run(3, { wantsPlaying: false })
  const [again] = run(14, { wantsPlaying: true })
  assert.equal(again.type, "retry")
  assert.equal(again.attempt, 1)
})

test("real progress after a retry refills the budget; a blip does not", () => {
  const { run } = rig()
  run(1, { resolved: true })
  assert.equal(run(13)[0].attempt, 1)
  run(1, { position: 0.4 }) // played a blip, stalls again
  assert.equal(run(13)[0].attempt, 2)
  for (let p = 1; p <= 10; p++) run(1, { position: p }) // recovered: 10 s of audio
  assert.equal(run(13)[0].attempt, 1)
})

test("media errors use the same budget, immediately", () => {
  const dog = new PlaybackWatchdog()
  const s = { now: 0, key: "1:yt:a", wantsPlaying: true, position: 42, resolved: true }
  assert.deepEqual(dog.fail(s), { type: "retry", attempt: 1, refresh: true, resumeAt: 42 })
  assert.equal(dog.fail(s).attempt, 2)
  assert.deepEqual(dog.fail(s), { type: "skip" })
  assert.equal(dog.fail({ ...s, key: "2:yt:b" }).type, "retry")
})

test("minutes offline and repeated network errors preserve the song; reconnect gets a fresh retry budget", () => {
  const { dog, s, run } = rig()
  run(1, { resolved: true, position: 73 })
  assert.equal(run(13)[0].attempt, 1)
  assert.deepEqual(run(5 * 60, { online: false }), [])
  for (let i = 0; i < 10; i++) assert.equal(dog.fail({ ...s }), null)
  assert.deepEqual(run(12, { online: true }), [])
  const [retry] = run(1)
  assert.equal(retry.attempt, 1)
  assert.equal(retry.resumeAt, 73)
})

test("advanced(): moved on vs stopped at the end of the queue", () => {
  assert.equal(advanced({ playbackId: 3 }, { playbackId: 4, loadingRecommendations: false }), true)
  assert.equal(advanced({ playbackId: 3 }, { playbackId: 3, loadingRecommendations: true }), true)
  assert.equal(advanced({ playbackId: 3 }, { playbackId: 3, loadingRecommendations: false }), false)
})

test("throttled stream (stop-and-go crumbs of audio) counts as stuck: retry, not endless silence", () => {
  const { run } = rig()
  run(1, { resolved: true })
  for (let p = 1; p <= 20; p++) run(1, { position: p })
  // Like a throttled audio URL: a fraction of a second every few seconds, which used to restart the clock forever.
  const actions = []
  let p = 20
  for (let i = 0; i < 40 && !actions.length; i++) { if (i % 3 === 0) p += 0.3; actions.push(...run(1, { position: p })) }
  assert.equal(actions[0]?.type, "retry")
  assert.equal(actions[0].refresh, true)
  assert.ok(actions[0].at <= 21_000 + 16_000, `retry too late: ${actions[0].at}`)
})

test("short bursts of real playback between long stalls do not reset the clock; a healthy stretch does", () => {
  const stopGo = rig()
  stopGo.run(1, { resolved: true })
  let p = 0
  const actions = []
  // 2 s playing, 4 s stalled, again and again: mostly silence.
  for (let i = 0; i < 60 && !actions.length; i++) { if (i % 6 < 2) p += 1; actions.push(...stopGo.run(1, { position: p })) }
  assert.equal(actions[0]?.type, "retry")
  const recovered = rig()
  recovered.run(1, { resolved: true })
  p = 0
  const none = []
  // 8 s stalled, then plays fine for a while, then 8 s stalled again: real buffering, never a retry.
  for (let i = 0; i < 8; i++) none.push(...recovered.run(1, { position: p }))
  for (let i = 0; i < 10; i++) none.push(...recovered.run(1, { position: ++p }))
  for (let i = 0; i < 8; i++) none.push(...recovered.run(1, { position: p }))
  for (let i = 0; i < 10; i++) none.push(...recovered.run(1, { position: ++p }))
  assert.deepEqual(none, [])
})

test("seeking (back or ahead) is a new starting point, not progress or a stall", () => {
  const { run } = rig()
  run(1, { resolved: true })
  for (let p = 1; p <= 30; p++) run(1, { position: p })
  assert.deepEqual(run(10, { position: 30 }), [])
  // Seek back: the 10 stuck seconds before it are forgotten.
  assert.deepEqual(run(1, { position: 5 }), [])
  assert.deepEqual(run(11, { position: 5 }), [])
  assert.equal(run(1, { position: 5 })[0]?.type, "retry")
})
