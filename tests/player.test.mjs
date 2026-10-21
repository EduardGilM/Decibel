import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"

const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
}
globalThis.window = { localStorage: globalThis.localStorage }
const { usePlayer } = await import("../src/stores/player.ts")
const { configurePlaybackRouter } = await import("../src/lib/audio/device-protocol.ts")
const player = () => usePlayer.getState()
const tracks = ["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"].map((id) => ({ id: `yt:${id}`, title: id, artist: "Artista", album: "Álbum", duration: 10 }))
const [a, b, c] = tracks

beforeEach(() => {
  configurePlaybackRouter(null)
  player().configureRecommendations(null)
  usePlayer.setState(usePlayer.getInitialState(), true)
  storage.clear()
})

test("remote playback routes transport and queue actions without changing local audio", async () => {
  player().playList(tracks)
  let seeks = 0
  usePlayer.setState({ audio: { set currentTime(_) { seeks++ } }, position: 4 })
  const commands = []
  configurePlaybackRouter((command) => { commands.push(command); return true })
  player().toggle()
  player().seek(8)
  await player().next()
  player().playList([b], 0, "Remoto")
  player().setVolume(0.2)
  player().moveQueueItem(0, 2)
  assert.deepEqual(commands.map((c) => c.action), ["toggle", "seek", "next", "playList", "setVolume", "moveQueueItem"])
  assert.equal(player().current(), a)
  assert.equal(player().position, 4)
  assert.equal(player().isPlaying, true)
  assert.equal(seeks, 0)
  configurePlaybackRouter(null)
  player().toggle()
  assert.equal(player().isPlaying, false)
})

test("repeat cycles through the three modes", () => {
  for (const mode of ["all", "one", "off"]) {
    player().cycleRepeat()
    assert.equal(player().repeat, mode)
  }
})

test("Seguir escuchando restores fractional position and the saved playlist order, even with shuffle enabled", () => {
  usePlayer.setState({ shuffle: true })
  const original = [a, b, c]
  const queue = [b, c, a]
  const before = player().playbackId
  player().playList(queue, 1, "playlist:guardada", { position: 7.625, original, shuffle: true, repeat: "all" })
  assert.deepEqual(player().queue, queue)
  assert.deepEqual(player().original, original)
  assert.equal(player().index, 1)
  assert.equal(player().current(), c)
  assert.equal(player().position, 7.625)
  assert.equal(player().duration, c.duration)
  assert.equal(player().sourceLabel, "playlist:guardada")
  assert.equal(player().repeat, "all")
  assert.equal(player().isPlaying, true)
  assert.equal(player().playbackId, before + 1)
  player().playList(queue, 2, "playlist:guardada", { position: 9.875, original, shuffle: false, repeat: "off" })
  assert.equal(player().position, 9.875, "resuming near the end must not round back a second")
  assert.equal(player().shuffle, false)
})

test("resuming is routed as a playback start with its position, so the device can claim local audio first", () => {
  const commands = []
  configurePlaybackRouter((command) => { commands.push(command); return true })
  const resume = { position: 7.625, original: tracks, shuffle: false, repeat: "off" }
  player().playList(tracks, 1, "playlist:p", resume)
  assert.deepEqual(commands, [{ action: "playList", args: [tracks, 1, "playlist:p", resume] }])
  assert.deepEqual(player().queue, [])
})

test("YouTube continues even if an older session saved autoplay as disabled", async () => {
  storage.set("decibel-player", JSON.stringify({ state: { queue: [a], original: [a], index: 0, autoplay: false }, version: 0 }))
  await usePlayer.persist.rehydrate()
  player().configureRecommendations(async () => [b])
  await player().next(true)
  assert.equal(player().current(), b)
  const saved = JSON.parse(storage.get("decibel-player")).state
  assert.equal("autoplay" in saved, false)
  assert.equal("recommendationLoader" in saved, false)
  assert.equal("playbackId" in saved, false)
})

test("pressing play after a track has ended starts a fresh playback", () => {
  player().playList([a])
  usePlayer.setState({ isPlaying: false, position: 10, audio: { ended: true } })
  const playbackId = player().playbackId
  player().toggle()
  assert.equal(player().isPlaying, true)
  assert.equal(player().position, 0)
  assert.equal(player().playbackId, playbackId + 1)
})

test("normal playback advances in queue order and stops if the source has no recommendations", async () => {
  player().playList([a, b])
  await player().next(true)
  assert.equal(player().current(), b)
  await player().next(true)
  assert.equal(player().current(), b)
  assert.equal(player().isPlaying, false)
})

test("repeat one restarts the current playback without requesting recommendations; a manual skip still advances", async () => {
  let requests = 0
  player().configureRecommendations(async () => { requests++; return [c] })
  player().playList([a, b])
  usePlayer.setState({ repeat: "one", position: 10 })
  const playbackId = player().playbackId
  await player().next(true)
  assert.equal(player().current(), a)
  assert.equal(player().position, 0)
  assert.equal(player().playbackId, playbackId + 1)
  assert.equal(player().isPlaying, true)
  await player().next()
  assert.equal(player().current(), b)
  assert.equal(requests, 0)
})

test("repeat all wraps a multi-track queue and restarts a one-track queue", async () => {
  player().configureRecommendations(async () => { assert.fail("Repeat must take priority over YouTube") })
  player().playList([a, b], 1)
  usePlayer.setState({ repeat: "all" })
  await player().next(true)
  assert.equal(player().current(), a)
  player().playList([a])
  const playbackId = player().playbackId
  await player().next(true)
  assert.equal(player().current(), a)
  assert.equal(player().index, 0)
  assert.equal(player().playbackId, playbackId + 1)
  assert.equal(player().isPlaying, true)
  await player().next(true)
  assert.equal(player().playbackId, playbackId + 2)
})

test("replaying or advancing to the same track still triggers a new playback", async () => {
  player().playList([a, a])
  const playbackId = player().playbackId
  await player().next(true)
  assert.equal(player().current(), a)
  assert.equal(player().playbackId, playbackId + 1)
  player().jumpTo(1)
  assert.equal(player().playbackId, playbackId + 2)
  player().playList([a])
  assert.equal(player().playbackId, playbackId + 3)
})

test("autoplay respects queued tracks, then adds unseen recommendations in YouTube order", async () => {
  const requests = []
  player().configureRecommendations(async (track) => { requests.push(track.id); return [a, b, c, c] })
  player().playList([a, b])
  await player().next(true)
  assert.equal(player().current(), b)
  assert.deepEqual(requests, [])
  await player().next(true)
  assert.deepEqual(requests, [b.id])
  assert.deepEqual(player().queue, [a, b, c])
  assert.deepEqual(player().original, [a, b, c])
  assert.equal(player().current(), c)
  assert.equal(player().sourceLabel, "Radio de YouTube")
  assert.equal(player().isPlaying, true)
  assert.equal(player().loadingRecommendations, false)
})

test("simultaneous next actions share a recommendation request", async () => {
  let resolve, requests = 0
  player().configureRecommendations(() => { requests++; return new Promise((done) => { resolve = done }) })
  player().playList([a])
  const first = player().next(true)
  await player().next()
  assert.equal(player().loadingRecommendations, true)
  assert.equal(requests, 1)
  resolve([b])
  await first
  assert.deepEqual(player().queue, [a, b])
})

const cancellations = {
  pause: () => player().setPlaying(false),
  "a new playlist": () => player().playList([c]),
  "a source change": () => player().configureRecommendations(null),
  "enabling repeat": () => player().cycleRepeat(),
  "a manually queued song": () => player().addToQueue(c),
}
for (const [name, cancel] of Object.entries(cancellations)) {
  test(`pending recommendations cannot replace playback after ${name}`, async () => {
    let resolve, signal
    player().configureRecommendations((_, abortSignal) => { signal = abortSignal; return new Promise((done) => { resolve = done }) })
    player().playList([a])
    const request = player().next(true)
    cancel()
    const queue = player().queue
    resolve([b])
    await request
    assert.equal(signal.aborted, true)
    assert.equal(player().queue, queue)
    assert.equal(player().loadingRecommendations, false)
  })
}

test("failed recommendations stop cleanly and can be retried", async () => {
  let attempts = 0
  player().configureRecommendations(async () => {
    if (++attempts === 1) throw new Error("YouTube no disponible")
    return [b]
  })
  player().playList([a])
  await player().next(true)
  assert.equal(player().recommendationError, "YouTube no disponible")
  assert.equal(player().isPlaying, false)
  assert.equal(player().buffering, false)
  assert.equal(player().loadingRecommendations, false)
  await player().next()
  assert.equal(player().current(), b)
  assert.equal(player().recommendationError, null)
})

test("empty or previously queued recommendations do not loop the current song", async () => {
  player().configureRecommendations(async () => [a])
  player().playList([a])
  const playbackId = player().playbackId
  await player().next(true)
  assert.equal(player().playbackId, playbackId)
  assert.equal(player().isPlaying, false)
  assert.match(player().recommendationError, /canciones nuevas/)
})

test("sources without recommendations keep their existing end-of-queue behavior", async () => {
  player().playList([{ ...a, id: "subsonic-track" }])
  await player().next(true)
  assert.equal(player().isPlaying, false)
  assert.equal(player().recommendationError, null)
})

test("restores the queue saved under the pre-Decibel key and migrates it", async () => {
  storage.set("musica-player", JSON.stringify({ state: { queue: [a], original: [a], index: 0 }, version: 0 }))
  await usePlayer.persist.rehydrate()
  assert.deepEqual(player().current(), a)
  player().setVolume(0.5)
  assert.equal(storage.has("musica-player"), false)
  assert.ok(storage.has("decibel-player"))
})
