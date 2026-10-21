import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"

const values = new Map()
globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
globalThis.window = { localStorage, location: { origin: "http://tauri.localhost" } }
const entries = new Map()
const keyOf = (key) => typeof key === "string" ? key : key.url
const disk = {
  match: async (key) => entries.get(keyOf(key))?.clone(),
  put: async (key, response) => { entries.set(keyOf(key), response.clone()) },
  delete: async (key) => entries.delete(keyOf(key)),
  keys: async () => [...entries.keys()].map((url) => new Request(url)),
}
globalThis.caches = { open: async () => disk }
const { download, offlineKey, offlineUrl, OFFLINE_CACHE, readAudio, reconcileDownloads, removeDownloads, useOffline, withOffline } = await import("../src/lib/offline/downloads.ts")
const { useConnection } = await import("../src/lib/offline/connection.ts")
const { downloadScope, usedBytes } = await import("../src/lib/offline/policy.ts")
const { playbackBuffer } = await import("../src/lib/audio/playback-buffer.ts")
const scope = downloadScope("ytdlp", "https://music.test", "alice")
const track = (id = "a") => ({ id: `yt:${id}`, title: `Canción ${id}`, album: "Álbum", artist: "Artista", duration: 30 })
const provider = (extra = {}, owner = scope) => withOffline({ kind: "ytdlp", streamUrl: async () => { throw new Error("CDN resolution should not run") }, downloadRequest: async (track) => ({ url: `https://music.test/api/music/stream?id=${track.id}`, headers: { Authorization: "Bearer disposable" } }), coverUrl: () => undefined, ...extra }, owner)
const audio = (bytes = "audio", headers = {}) => new Response(bytes, { headers: { "Content-Type": "audio/webm", ...headers } })
const state = () => useOffline.getState()

beforeEach(async () => {
  playbackBuffer.clear()
  await removeDownloads(Object.keys(state().items))
  entries.clear(); values.clear()
  useOffline.setState({ items: {}, pending: {}, limitMB: 10 })
  useConnection.setState({ offline: false })
})

test("temporary current/next copies play offline through the provider without becoming saved downloads", async (t) => {
  const p = provider()
  playbackBuffer.retain(scope, [track().id, track("b").id])
  t.mock.method(globalThis, "fetch", async () => audio())
  await playbackBuffer.prepare(track(), p)
  await playbackBuffer.prepare(track("b"), p)
  useConnection.setState({ offline: true })
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Offline") })
  for (const song of [track(), track("b")]) assert.equal(await p.streamUrl(song), playbackBuffer.url(scope, song.id))
  assert.deepEqual(state().items, {})
  assert.equal(entries.size, 0)
  await assert.rejects(provider({}, "other-profile").streamUrl(track()), /no está descargada/)
})

test("a connection loss preserves artwork URLs and therefore the current image and sampled theme", () => {
  const p = provider({ coverUrl: (art, size) => art ? `https://music.test/art/${art}?size=${size}` : undefined })
  const before = p.coverUrl("cover-a", 64)
  useConnection.setState({ offline: true })
  assert.equal(p.coverUrl("cover-a", 64), before)
  assert.equal(p.coverUrl(undefined, 64), undefined)
  useConnection.setState({ offline: false })
  assert.equal(p.coverUrl("cover-a", 64), before)
})

test("album/list downloads deduplicate tracks, persist complete bytes, and play without any network after a restart", async (t) => {
  const calls = []
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); return audio() })
  const result = await download([track(), track(), track("b")], provider())
  assert.deepEqual(result, { ok: 2, failed: [] })
  assert.equal(calls.length, 2)
  assert.ok(calls.every((r) => r.url.startsWith("https://music.test/api/music/stream?") && r.init.headers.Authorization === "Bearer disposable"))
  assert.equal(usedBytes(state().items), 10)
  assert.deepEqual(state().pending, {})
  assert.equal(entries.size, 2)
  assert.ok(!JSON.stringify([...entries.values()].map((r) => [...r.headers])).includes("disposable"))
  // Lose localStorage metadata as well: the disk copy carries its own recoverable metadata.
  useOffline.setState({ items: {} })
  await reconcileDownloads()
  assert.equal(Object.keys(state().items).length, 2)
  useConnection.setState({ offline: true })
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Network is unavailable") })
  const url = await provider().streamUrl(track())
  assert.ok(url.startsWith("blob:"))
  const { resolveObjectURL } = await import("node:buffer")
  assert.equal(await resolveObjectURL(url).text(), "audio")
  assert.equal(OFFLINE_CACHE, "decibel-offline-v2")
})

test("concurrent completions share a serialized quota check", async (t) => {
  useOffline.setState({ limitMB: 1 })
  t.mock.method(globalThis, "fetch", async () => audio(new Uint8Array(700 * 1024)))
  const result = await download([track(), track("b")], provider())
  assert.equal(result.ok, 1)
  assert.equal(result.failed.length, 1)
  assert.match(result.failed[0], /Sin espacio/)
  assert.equal(Object.keys(state().items).length, 1)
  assert.ok(usedBytes(state().items) <= 1024 * 1024)
})

test("simultaneous requests for the same song share the download", async (t) => {
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => { calls++; return audio() })
  const p = provider()
  await Promise.all([download([track()], p), download([track()], p)])
  assert.equal(calls, 1)
  assert.equal(Object.keys(state().items).length, 1)
})

test("failed disk writes, invalid audio and truncated responses never produce a playable download", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("error", { headers: { "Content-Type": "text/html" } }))
  assert.equal((await download([track()], provider())).failed.length, 1)
  t.mock.method(globalThis, "fetch", async () => audio("abc", { "Content-Length": "9" }))
  assert.equal((await download([track()], provider())).failed.length, 1)
  t.mock.method(globalThis, "fetch", async () => audio())
  t.mock.method(disk, "put", async () => { throw new DOMException("Full", "QuotaExceededError") })
  assert.equal((await download([track()], provider())).failed.length, 1)
  assert.deepEqual(state().items, {})
  assert.deepEqual(state().pending, {})
  assert.equal(await offlineUrl("ytdlp", track().id, scope), null)
})

test("deleting active and queued downloads cancels requests and prevents late writes", async (t) => {
  const started = []
  let release
  const ready = new Promise((r) => { release = r })
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => {
    started.push(signal); if (started.length === 2) release()
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
  })
  const tracks = [track(), track("b"), track("c")]
  const pending = download(tracks, provider())
  await ready
  await removeDownloads(tracks.map((t) => offlineKey("ytdlp", t.id, scope)))
  await pending
  assert.equal(started.length, 2)
  assert.ok(started.every((s) => s.aborted))
  assert.deepEqual(state().pending, {})
  assert.deepEqual(state().items, {})
  assert.equal(entries.size, 0)
})

test("profile/server changes hide another library's audio and evicted audio is removed from metadata", async (t) => {
  t.mock.method(globalThis, "fetch", async () => audio())
  await download([track()], provider())
  useConnection.setState({ offline: true })
  await assert.rejects(provider({}, downloadScope("ytdlp", "https://music.test", "bob")).streamUrl(track()), /no está descargada/)
  await assert.rejects(provider({}, downloadScope("ytdlp", "https://other.test", "alice")).streamUrl(track()), /no está descargada/)
  entries.clear()
  await reconcileDownloads()
  assert.deepEqual(state().items, {})
  await assert.rejects(provider().streamUrl(track()), /no está descargada/)
})

test("downloaded playback skips preparation, recommendations and scrobbling while offline; missing songs fail locally", async (t) => {
  let remote = 0
  const p = provider({ prepareTrack: async () => { remote++ }, getRecommendations: async () => { remote++; return [track()] }, scrobble: async () => { remote++ } })
  t.mock.method(globalThis, "fetch", async () => audio())
  await download([track()], p)
  await p.prepareTrack(track())
  assert.equal(remote, 0)
  useConnection.setState({ offline: true })
  await p.prepareTrack(track("b"))
  assert.deepEqual(await p.getRecommendations(track()), [])
  await p.scrobble(track().id, true)
  await assert.rejects(p.streamUrl(track("missing")), /no está descargada/)
  await assert.rejects(download([track("b")], p), /Conéctate/)
  assert.equal(remote, 0)
})

test("whole, nonempty and bounded files only; Range responses and cancelled streams are rejected", async () => {
  const controller = new AbortController()
  await assert.rejects(readAudio(audio(""), 100, controller.signal), /incompleta/)
  await assert.rejects(readAudio(audio("toolarge"), 2, controller.signal), /Sin espacio/)
  await assert.rejects(readAudio(new Response("abc", { status: 206, headers: { "Content-Type": "audio/webm" } }), 100, controller.signal))
  controller.abort()
  await assert.rejects(readAudio(audio(), 100, controller.signal))
})

test("covers persist on disk and storage management deletes both cover and audio", async (t) => {
  const p = provider({ coverUrl: () => "https://music.test/api/music/artwork?url=cover" })
  t.mock.method(globalThis, "fetch", async (url) => url.includes("artwork") ? new Response("image", { headers: { "Content-Type": "image/png" } }) : audio())
  const song = { ...track(), coverArt: "https://cdn.test/cover" }
  assert.equal((await download([song], p)).ok, 1)
  assert.equal(usedBytes(state().items), 10)
  assert.equal(entries.size, 2)
  useConnection.setState({ offline: true })
  assert.ok(p.coverUrl(song.coverArt).startsWith("blob:"))
  await removeDownloads([offlineKey("ytdlp", song.id, scope)])
  assert.equal(usedBytes(state().items), 0)
  assert.equal(entries.size, 0)
  await assert.rejects(p.streamUrl(song), /no está descargada/)
})

test("a removal during the disk commit rolls back the late write", async (t) => {
  let committing, release
  const started = new Promise((resolve) => { committing = resolve })
  const gate = new Promise((resolve) => { release = resolve })
  const put = disk.put
  t.mock.method(globalThis, "fetch", async () => audio())
  t.mock.method(disk, "put", async (...args) => { committing(); await gate; return put(...args) })
  const downloading = download([track()], provider())
  await started
  const removing = removeDownloads([offlineKey("ytdlp", track().id, scope)])
  release()
  await Promise.all([downloading, removing])
  assert.equal(entries.size, 0)
  assert.deepEqual(state().items, {})
})

test("legacy copies remain removable and counted without assigning them to another server or profile", async () => {
  const key = "subsonic:old-track"
  const legacy = { source: "subsonic", track: track("old-track"), size: 5, savedAt: 1 }
  entries.set(`https://offline.decibel.local/${encodeURIComponent(key)}`, audio())
  useOffline.setState({ items: { [key]: legacy } })
  await reconcileDownloads()
  assert.equal(usedBytes(state().items), 5)
  assert.equal(state().items[key].scope, undefined)
  useConnection.setState({ offline: true })
  await assert.rejects(provider().streamUrl(legacy.track), /no está descargada/)
  await removeDownloads([key])
  assert.equal(entries.size, 0)
  assert.deepEqual(state().items, {})
})
