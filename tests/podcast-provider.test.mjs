import assert from "node:assert/strict"
import { after, beforeEach, test } from "node:test"
import { PodcastProvider, withPodcasts } from "../src/lib/providers/podcasts.ts"
import { podcastCover, podcastTrack } from "../src/lib/podcasts.ts"
import { artworkSessionHeaders, saveSessionToken } from "../src/lib/profile/session-token.ts"

const previousWindow = globalThis.window, values = new Map(), events = []
globalThis.window = { location: { origin: "https://tauri.localhost" }, localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }, dispatchEvent: (event) => { events.push(event.type); return true } }
after(() => { globalThis.window = previousWindow })
beforeEach(() => { values.clear(); events.length = 0; values.set("decibel-server-url", "https://music.test/decibel"); saveSessionToken("https://music.test/decibel", "podcast-fixture-token") })
const episode = { id: "episode:" + "a".repeat(40), podcastId: "podcast:" + "b".repeat(32), title: "Episodio", podcastTitle: "Programa", author: "Autora", duration: 3600, coverArt: "https://publisher.example/art.jpg", enclosureUrl: "https://media.example/episode.mp3" }

test("top uses the shared profile authentication, country, response shape and cancellation", async (t) => {
  const calls = [], result = { country: "ES", source: "apple-charts", updatedAt: 123, sections: [{ id: "all", title: "Más escuchados", podcasts: [] }] }
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); return Response.json(result) })
  const podcasts = new PodcastProvider()
  assert.deepEqual(await podcasts.getTop(), result)
  await podcasts.getTop("GB")
  assert.equal(new URL(calls[0].url).pathname, "/decibel/api/podcasts/top")
  assert.equal(new URL(calls[0].url).searchParams.get("country"), "ES")
  assert.equal(new URL(calls[1].url).searchParams.get("country"), "GB")
  assert.ok(calls.every((c) => c.init.headers.Authorization === "Bearer podcast-fixture-token" && c.init.credentials === "include" && c.init.signal))
  const controller = new AbortController(), reason = new Error("left podcasts")
  controller.abort(reason)
  t.mock.method(globalThis, "fetch", async (_url, init) => { throw init.signal.reason })
  await assert.rejects(podcasts.getTop("ES", controller.signal), (error) => error === reason)
})

test("follow methods use the agreed API with scoped auth and notify the library after success", async (t) => {
  const calls = []
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init })
    return Response.json(init.method === "GET" ? { podcasts: [] } : { following: init.method === "PUT" })
  })
  const podcasts = new PodcastProvider(), signal = new AbortController().signal
  assert.deepEqual(await podcasts.getFollows(signal), { podcasts: [] })
  assert.deepEqual(await podcasts.follow(episode.podcastId, signal), { following: true })
  assert.deepEqual(await podcasts.unfollow(episode.podcastId, signal), { following: false })
  assert.deepEqual(calls.map((c) => c.init.method), ["GET", "PUT", "DELETE"])
  assert.ok(calls.every((c) => new URL(c.url).pathname === "/decibel/api/podcasts/follows" && c.init.headers.Authorization === "Bearer podcast-fixture-token" && c.init.credentials === "include" && c.init.signal))
  assert.equal(new URL(calls[1].url).searchParams.get("id"), episode.podcastId)
  assert.deepEqual(events, ["decibel:data-changed", "decibel:data-changed"])
})

test("podcast provider sends scoped Bearer auth, filters, pagination and seconds-based progress", async (t) => {
  const calls = []
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); return Response.json(url.includes("/episode?") ? { episode } : {}) })
  const podcasts = new PodcastProvider(), controller = new AbortController()
  await podcasts.search("física & ciencia", { kind: "episodes", country: "ES", limit: 7, signal: controller.signal })
  await podcasts.getPodcast(episode.podcastId, { q: "luna", offset: 20, limit: 10 })
  await podcasts.importFeed("https://feeds.example/feed.xml")
  assert.equal((await podcasts.getEpisode(episode.id)).id, episode.id)
  await podcasts.getProgress(episode.id)
  await podcasts.saveProgress(episode.id, { position: 120.5, completed: false, expectedRevision: 2 })
  await podcasts.getListening({ completed: false, offset: 10, limit: 20 })
  assert.equal(new URL(calls[0].url).searchParams.get("q"), "física & ciencia")
  assert.equal(new URL(calls[0].url).searchParams.get("kind"), "episodes")
  assert.equal(new URL(calls[1].url).searchParams.get("offset"), "20")
  assert.deepEqual(JSON.parse(calls[5].init.body), { position: 120.5, completed: false, expectedRevision: 2 })
  assert.equal(calls[5].init.method, "PUT")
  assert.ok(calls.every(({ init }) => init.headers.Authorization === "Bearer podcast-fixture-token" && init.credentials === "include" && init.signal))
})

test("existing queue streams RSS audio without resolving YouTube and retains normal music behavior", async (t) => {
  const calls = [], normal = []
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); return Response.json({ url: episode.enclosureUrl, resumePosition: 12, episode }) })
  const inner = { kind: "ytdlp", streamUrl: async (...args) => { normal.push(["stream", ...args]); return "music-url" }, prepareTrack: async () => normal.push(["prepare"]), getRecommendations: async () => { normal.push(["radio"]); return [] }, scrobble: async () => normal.push(["scrobble"]), coverUrl: (value, size) => `${value}:${size}` }
  const provider = withPodcasts(inner), track = podcastTrack(episode)
  assert.equal(track.podcast.episodeId, episode.id)
  assert.equal(await provider.streamUrl(track), episode.enclosureUrl)
  await provider.prepareTrack(track)
  assert.deepEqual(await provider.getRecommendations(track), [])
  await provider.scrobble(track.id, true)
  assert.equal(normal.length, 0)
  assert.equal(calls.length, 1)
  assert.equal(new URL(calls[0].url).pathname, "/decibel/api/podcasts/stream")
  assert.equal(new URL(provider.coverUrl(track.coverArt, 400)).pathname, "/decibel/api/podcasts/artwork")
  assert.deepEqual(artworkSessionHeaders(provider.coverUrl(track.coverArt)), { Authorization: "Bearer podcast-fixture-token" })
  assert.deepEqual(artworkSessionHeaders("https://media.example/api/podcasts/artwork"), {})
  const music = { id: "yt:test" }
  assert.equal(await provider.streamUrl(music), "music-url")
  await provider.prepareTrack(music); await provider.getRecommendations(music); await provider.scrobble(music.id, true)
  assert.equal(normal.length, 4)
  assert.equal(provider.coverUrl("music-cover", 80), "music-cover:80")
  assert.equal(podcastCover({ ...episode, coverArt: undefined }), undefined)
})

test("podcast API errors preserve status and explicit cancellation is propagated", async (t) => {
  const podcasts = new PodcastProvider()
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "Changed" }, { status: 409 }))
  await assert.rejects(podcasts.saveProgress(episode.id, { position: 2, expectedRevision: 1 }), { status: 409 })
  const controller = new AbortController(), reason = new Error("changed episode")
  controller.abort(reason)
  t.mock.method(globalThis, "fetch", async (_url, init) => { throw init.signal.reason })
  await assert.rejects(podcasts.getStream(episode.id, controller.signal), (error) => error === reason)
})
