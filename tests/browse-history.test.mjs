import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import { createBrowseTracker, MAX_BROWSE_RECENT, playbackPosition, rememberPlayback } from "../src/lib/browse-history.ts"

const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
}
globalThis.window = { localStorage: globalThis.localStorage }
const { useBrowse } = await import("../src/stores/browse.ts")
const tracks = ["a", "b", "c"].map((id) => ({ id, title: id, artist: "Artista", album: "Álbum", duration: 180, starred: true }))
const state = { queue: tracks, original: [...tracks].reverse(), index: 1, position: 73.625, duration: 180, shuffle: true, repeat: "all", sourceLabel: "playlist:p", isPlaying: true, buffering: false, playbackId: 1 }

beforeEach(() => { useBrowse.setState({ profiles: {} }); storage.clear() })

test("saves the exact position, playlist, queue and shuffle order without stale likes or playback flags", () => {
  const history = rememberPlayback(undefined, state)
  assert.equal(history.last.position, 73.625)
  assert.equal(history.last.index, 1)
  assert.equal(history.last.sourceLabel, "playlist:p")
  assert.deepEqual(history.last.original.map((t) => t.id), ["c", "b", "a"])
  assert.equal(history.last.shuffle, true)
  assert.equal(history.last.repeat, "all")
  assert.equal("starred" in history.last.queue[0], false)
  assert.equal("isPlaying" in history.last, false)
  assert.equal("audio" in history.last, false)
  assert.equal(tracks[0].starred, true)
})

test("Recientes deduplicates tracks, refreshes metadata and bounds storage; podcasts keep their own progress", () => {
  let history
  for (let i = 0; i < 20; i++) history = rememberPlayback(history, { ...state, queue: [{ ...tracks[0], id: String(i) }], index: 0 })
  assert.equal(history.recent.length, MAX_BROWSE_RECENT)
  history = rememberPlayback(history, { ...state, queue: [{ ...tracks[0], id: "15", title: "Actualizado" }], index: 0 })
  assert.equal(history.recent[0].title, "Actualizado")
  assert.equal(history.recent.filter((t) => t.id === "15").length, 1)
  assert.equal(rememberPlayback(history, { ...state, queue: [], index: 0 }), history)
  assert.equal(rememberPlayback(history, { ...state, queue: [{ ...tracks[0], podcast: { episodeId: "e", podcastId: "p" } }], index: 0 }), history)
})

test("progress and recents survive reloads and stay separate for every profile, source and server", async () => {
  const scopes = ["server#ana", "server#luis", "other-server#ana", "subsonic#ana"]
  for (let i = 0; i < scopes.length; i++) useBrowse.getState().remember(scopes[i], { ...state, position: i + 0.125 })
  const saved = storage.get("decibel-browse")
  useBrowse.setState({ profiles: {} })
  storage.set("decibel-browse", saved)
  await useBrowse.persist.rehydrate()
  for (let i = 0; i < scopes.length; i++) assert.equal(useBrowse.getState().profiles[scopes[i]].last.position, i + 0.125)
  assert.equal(useBrowse.getState().profiles["new-profile"], undefined)
})

test("tracking ignores inherited queues and buffering resets, throttles progress, flushes exact seeks and pauses", () => {
  const saved = []
  let now = 0
  const track = createBrowseTracker((s) => saved.push(s.position), () => now)
  const inherited = { ...state, isPlaying: false }
  track(inherited, inherited, true)
  assert.deepEqual(saved, [])
  track(state, inherited)
  assert.deepEqual(saved, [73.625])
  const loading = { ...state, buffering: true, position: 0 }
  track(loading, state)
  track(loading, loading, true)
  assert.equal(saved.length, 1)
  const playing = { ...state, position: 73.875 }
  track(playing, state)
  assert.equal(saved.length, 1)
  now = 2000
  track(playing, playing)
  assert.equal(saved.at(-1), 73.875)
  const seeked = { ...state, position: 111.375 }
  track(seeked, playing)
  assert.equal(saved.at(-1), 111.375)
  const paused = { ...seeked, isPlaying: false, position: 111.625 }
  track(paused, seeked)
  assert.equal(saved.at(-1), 111.625)
  const closing = { ...seeked, position: 111.875 }
  track(closing, closing, true)
  assert.equal(saved.at(-1), 111.875)
})

test("positions are finite and bounded without discarding fractions or unknown durations", () => {
  assert.equal(playbackPosition(-2, 180), 0)
  assert.equal(playbackPosition(Infinity, 180), 0)
  assert.equal(playbackPosition(NaN, 180), 0)
  assert.equal(playbackPosition(181, 180), 180)
  assert.equal(playbackPosition(179.875, 180), 179.875)
  assert.equal(playbackPosition(73.625, 0), 73.625)
})
