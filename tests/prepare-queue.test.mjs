import assert from "node:assert/strict"
import test from "node:test"
import { prepareQueuedTracks, upcomingTracks } from "../src/lib/prepare-queue.ts"
import { YtDlpProvider } from "../src/lib/providers/ytdlp.ts"

const tracks = ["a", "b", "c", "d", "e"].map((id) => ({ id, title: id, duration: 180 }))

test("queue preparation follows the next three unique songs, wrapping only for repeat all", () => {
  assert.deepEqual(upcomingTracks(tracks, 0, "off"), tracks.slice(1, 4))
  assert.deepEqual(upcomingTracks(tracks, 3, "all"), [tracks[4], tracks[0], tracks[1]])
  assert.deepEqual(upcomingTracks(tracks, 2, "one"), [tracks[2]])
  assert.deepEqual(upcomingTracks([tracks[0], tracks[1], tracks[1], tracks[2]], 0, "off"), [tracks[1], tracks[2]])
  assert.deepEqual(upcomingTracks([], 0, "off"), [])
})

test("preparation is serial, bounded and continues after an unavailable song", async () => {
  const calls = []
  let active = 0, peak = 0
  await prepareQueuedTracks(tracks, async (track) => {
    calls.push(track.id)
    peak = Math.max(peak, ++active)
    await Promise.resolve()
    active--
    if (track.id === "b") throw Object.assign(new Error("unavailable"), { status: 404 })
  }, new AbortController().signal)
  assert.deepEqual(calls, ["a", "b", "c"])
  assert.equal(peak, 1)
})

test("a busy server triggers limited backoff before the next queued song", async () => {
  const calls = [], waits = []
  await prepareQueuedTracks(tracks.slice(0, 2), async (track) => {
    calls.push(track.id)
    if (track.id === "a") throw Object.assign(new Error("busy"), { status: 429 })
  }, new AbortController().signal, async (delay) => { waits.push(delay) })
  assert.deepEqual(calls, ["a", "a", "a", "a", "b"])
  assert.deepEqual(waits, [500, 1000, 2000])
})

test("cancelling after a queue edit prevents any remaining preparation", async () => {
  const controller = new AbortController(), calls = []
  await prepareQueuedTracks(tracks, async (track) => {
    calls.push(track.id)
    controller.abort()
    throw new Error("cancelled")
  }, controller.signal)
  assert.deepEqual(calls, ["a"])
})

test("the YouTube provider preserves HTTP busy status for the preparation scheduler", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Hay varias canciones preparándose." }, { status: 429 }))
  await assert.rejects(new YtDlpProvider().prepareTrack(tracks[0]), { status: 429 })
})
