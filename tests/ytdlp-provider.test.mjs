import assert from "node:assert/strict"
import test from "node:test"
import { YtDlpProvider } from "../src/lib/providers/ytdlp.ts"

test("creating and adding to a playlist send IDs and refresh the visible library after success", async (t) => {
  const requests = [], events = []
  const previousWindow = globalThis.window
  globalThis.window = { dispatchEvent: (event) => events.push(event.type) }
  t.after(() => { globalThis.window = previousWindow })
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, method: init.method, body: JSON.parse(init.body) })
    return Response.json({ id: "user-list:test", name: "Rock", editable: true })
  })
  const provider = new YtDlpProvider("http://music.test")
  const track = { id: "yt:aaaaaaaaaaa" }
  assert.equal((await provider.createPlaylist("Rock", track)).id, "user-list:test")
  await provider.addToPlaylist("user-list:test", track)
  assert.deepEqual(requests.map((request) => request.body), [{ name: "Rock", id: track.id }, { playlistId: "user-list:test", id: track.id }])
  assert.deepEqual(requests.map((request) => request.url), ["http://music.test/api/music/playlists", "http://music.test/api/music/playlist-tracks"])
  assert.ok(requests.every((request) => request.method === "POST"))
  assert.deepEqual(events, ["decibel:data-changed", "decibel:data-changed"])
})

test("search filters reach the music API while preserving cancellation", async (t) => {
  const requests = []
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url: new URL(url), signal: init.signal })
    return Response.json({ tracks: [], albums: [], artists: [] })
  })
  const provider = new YtDlpProvider("http://music.test")
  const controller = new AbortController()
  await provider.search("La ley innata", controller.signal, "albums")
  assert.equal(requests[0].url.searchParams.get("q"), "La ley innata")
  assert.equal(requests[0].url.searchParams.get("type"), "albums")
  controller.abort()
  assert.equal(requests[0].signal.aborted, true)
  await provider.search("A fuego", undefined, "tracks")
  assert.equal(requests[1].url.searchParams.get("type"), "tracks")
  await provider.search("Extremoduro")
  assert.equal(requests[2].url.searchParams.get("type"), "all")
})

test("artwork uses the configured music server and preserves the original CDN URL", () => {
  const cover = "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg?sqp=a&size=300"
  const provider = new YtDlpProvider("https://music.test/decibel/")
  assert.equal(provider.coverUrl(cover), `https://music.test/decibel/api/music/artwork?url=${encodeURIComponent(cover)}`)
  assert.equal(provider.coverUrl(undefined), undefined)
  assert.equal(provider.coverUrl(""), undefined)
  assert.equal(new YtDlpProvider().coverUrl(cover), `/api/music/artwork?url=${encodeURIComponent(cover)}`)
})

test("preparing a song preserves cancellation and only playback refreshes the library UI", async (t) => {
  const requests = [], events = []
  const previousWindow = globalThis.window
  globalThis.window = { dispatchEvent: (event) => events.push(event.type) }
  t.after(() => { globalThis.window = previousWindow })
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests.push({ url, ...init, body: JSON.parse(init.body) })
    return Response.json(url.endsWith("/prepare") ? { ok: true } : { url: "https://audio.googlevideo.com/valid" })
  })
  const provider = new YtDlpProvider("http://music.test")
  const track = { id: "yt:aaaaaaaaaaa" }
  const controller = new AbortController()
  await provider.prepareTrack(track, controller.signal)
  assert.equal(requests[0].url, "http://music.test/api/music/prepare")
  assert.deepEqual(requests[0].body, { id: track.id })
  assert.deepEqual(events, [])
  controller.abort()
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(await provider.streamUrl(track), "https://audio.googlevideo.com/valid")
  assert.equal(requests[1].body.refresh, false)
  await provider.streamUrl(track, undefined, true)
  assert.equal(requests[2].body.refresh, true)
  assert.deepEqual(events, ["decibel:data-changed", "decibel:data-changed"])
})
