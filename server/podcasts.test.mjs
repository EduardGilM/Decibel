import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { openDb } from "./db.mjs"
import { createAccounts } from "./accounts.mjs"
import { createApp } from "./index.mjs"
import { createProfileApi } from "./profile-api.mjs"
import { createPodcastService } from "./podcasts.mjs"
import { appleEpisode, audio, audioUrl, feedUrl, fixtureRequest, imageUrl, remote, rss } from "../tests/fixtures/podcasts.mjs"

async function setup(t, options = {}) {
  const profiles = await createProfileApi({ seed: false })
  const a = await profiles.accounts.createUser({ username: "Listener A", password: "password-a" })
  const b = await profiles.accounts.createUser({ username: "Listener B", password: "password-b" })
  const calls = [], podcasts = createPodcastService({ db: profiles.db, request: fixtureRequest(calls), ...options })
  const app = await createApp({ profiles, podcasts, allowedOrigins: ["https://tauri.localhost"] })
  app.listen(0, "127.0.0.1"); await once(app, "listening")
  t.after(async () => { await new Promise((done) => { app.close(done); app.closeAllConnections() }); profiles.db.close() })
  const base = `http://127.0.0.1:${app.address().port}`
  const request = (path, { token, body, method = "GET", headers = {} } = {}) => fetch(base + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const tokenA = profiles.accounts.createSession(a.id, "fixture"), tokenB = profiles.accounts.createSession(b.id, "fixture")
  return { profiles, podcasts, request, tokenA, tokenB, a, b, calls }
}

test("podcast APIs require a session and accept cookie/Bearer; native CORS supports Range", async (t) => {
  const { request, tokenA, calls } = await setup(t)
  for (const path of ["search?q=test", "show?id=x", "follows", "episode?id=x", "progress?id=x", "listening", "audio?id=x", "artwork?id=x"]) assert.equal((await request(`/api/podcasts/${path}`)).status, 401)
  assert.equal(calls.length, 0)
  assert.equal((await request("/api/podcasts/search?q=test", { token: "forged" })).status, 401)
  const cookie = await request("/api/podcasts/search?q=test&kind=podcasts", { headers: { Cookie: `decibel_session=${tokenA}` } })
  assert.equal(cookie.status, 200)
  const preflight = await request("/api/podcasts/audio", { method: "OPTIONS", headers: { Origin: "https://tauri.localhost", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Authorization, Range, If-Range" } })
  assert.equal(preflight.status, 204)
  assert.match(preflight.headers.get("access-control-allow-headers"), /Range/)
  assert.equal((await request("/api/podcasts/search?q=test", { token: tokenA, headers: { Origin: "https://foreign.example" } })).status, 403)
})

test("search returns full episode enclosures, shares catalogue requests, and keeps progress per profile", async (t) => {
  const { request, tokenA, tokenB, calls } = await setup(t)
  const result = await Promise.all([request("/api/podcasts/search?q=ciencia", { token: tokenA }), request("/api/podcasts/search?q=ciencia", { token: tokenB })])
  const data = await Promise.all(result.map((r) => r.json()))
  assert.equal(calls.length, 2)
  assert.equal(data[0].podcasts.length, 1)
  const episode = data[0].episodes[0], id = encodeURIComponent(episode.id)
  assert.equal(episode.enclosureUrl, audioUrl)
  assert.equal(episode.progress.revision, 0)
  const saved = await request(`/api/podcasts/progress?id=${id}`, { token: tokenA, method: "PUT", body: { position: 123.5, duration: 3723, expectedRevision: 0 } })
  assert.equal(saved.status, 200)
  assert.equal((await saved.json()).revision, 1)
  assert.equal((await (await request(`/api/podcasts/progress?id=${id}`, { token: tokenB })).json()).position, 0)
  const stream = await (await request("/api/podcasts/stream", { token: tokenA, method: "POST", body: { id: episode.id } })).json()
  assert.equal(stream.url, audioUrl)
  assert.equal(stream.resumePosition, 123.5)
  const cachedSearch = await (await request("/api/podcasts/search?q=ciencia", { token: tokenA })).json()
  assert.equal(cachedSearch.episodes[0].progress.position, 123.5)
  assert.equal(calls.length, 2)
  assert.equal((await request(`/api/podcasts/progress?id=${id}`, { token: tokenA, method: "PUT", body: { position: 10, expectedRevision: 0 } })).status, 409)
  await request(`/api/podcasts/progress?id=${id}`, { token: tokenA, method: "PUT", body: { completed: true, expectedRevision: 1 } })
  const completed = await (await request(`/api/podcasts/progress?id=${id}`, { token: tokenA })).json()
  assert.equal(completed.completed, true); assert.equal(completed.resumePosition, 0)
  assert.equal((await (await request("/api/podcasts/listening?completed=true", { token: tokenA })).json()).total, 1)
  assert.equal((await (await request("/api/podcasts/listening", { token: tokenB })).json()).total, 0)
  await request(`/api/podcasts/progress?id=${id}`, { token: tokenA, method: "PUT", body: { completed: false, position: 0 } })
  assert.equal((await (await request(`/api/podcasts/progress?id=${id}`, { token: tokenA })).json()).position, 0)
})

test("RSS import, canonical GUIDs, local episode search, pagination and cached outage fallback", async (t) => {
  let clock = 1000000, unavailable = false
  const calls = [], fixture = fixtureRequest(calls)
  const request = async (url, options) => {
    if (url === feedUrl && unavailable) throw new TypeError("offline")
    return fixture(url, options)
  }
  const { podcasts, a } = await setup(t, { request, now: () => clock })
  const search = await podcasts.search(a.id, { q: "ciencia", kind: "episodes" })
  const episode = search.episodes[0]
  podcasts.saveProgress(a.id, episode.id, { position: 80 })
  const imported = await podcasts.importFeed(a.id, feedUrl)
  assert.equal(imported.podcast.title, "Conversaciones")
  assert.equal(imported.total, 2)
  assert.equal(imported.episodes[0].id, episode.id)
  assert.equal(imported.episodes[0].progress.position, 80)
  assert.equal((await podcasts.importFeed(a.id, feedUrl)).podcast.title, "Conversaciones")
  const page = await podcasts.getShow(a.id, imported.podcast.id, { q: "fisica", limit: 1 })
  assert.equal(page.total, 1)
  assert.equal(page.episodes[0].id, episode.id)
  assert.equal((await podcasts.getShow(a.id, imported.podcast.id, { offset: 1, limit: 1 })).episodes.length, 1)
  assert.equal(calls.filter((c) => c.url === feedUrl).length, 1)
  unavailable = true; clock += 600001
  const stale = await podcasts.getShow(a.id, imported.podcast.id)
  assert.equal(stale.stale, true)
  assert.equal(stale.episodes.length, 2)
})

test("feed conditional refresh retains progress when an enclosure URL changes", async (t) => {
  let clock = 1000000, step = 0
  const calls = []
  const { podcasts, a } = await setup(t, { now: () => clock, request: async (url, options) => {
    calls.push(options)
    if (step === 1) return remote("", { status: 304 })
    return remote(step === 2 ? rss.replace(audioUrl, audioUrl + "?renewed=1") : rss, { headers: { etag: '"v1"' }, url })
  } })
  const data = await podcasts.importFeed(a.id, feedUrl), id = data.episodes[0].id
  podcasts.saveProgress(a.id, id, { position: 50 })
  clock += 600001; step = 1
  await podcasts.getShow(a.id, data.podcast.id)
  assert.equal(calls[1].headers["If-None-Match"], '"v1"')
  clock += 600001; step = 2
  const fresh = await podcasts.getShow(a.id, data.podcast.id)
  assert.equal(fresh.episodes[0].id, id)
  assert.equal(fresh.episodes[0].progress.position, 50)
  assert.equal(podcasts.getStream(a.id, id).url, audioUrl + "?renewed=1")
})

test("audio proxy passes Range and If-Range, streams 206, supports HEAD and preserves 416", async (t) => {
  const { podcasts, a, request, tokenA, calls } = await setup(t)
  const data = await podcasts.importFeed(a.id, feedUrl), id = encodeURIComponent(data.episodes[0].id)
  const response = await request(`/api/podcasts/audio?id=${id}`, { token: tokenA, headers: { Range: "bytes=10-19", "If-Range": '"audio-v1"', Origin: "https://tauri.localhost" } })
  assert.equal(response.status, 206)
  assert.equal(response.headers.get("content-range"), "bytes 10-19/36")
  assert.equal(response.headers.get("content-length"), "10")
  assert.match(response.headers.get("access-control-expose-headers"), /Content-Range/)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), audio.subarray(10, 20))
  const upstream = calls.find((c) => c.url === audioUrl)
  assert.equal(upstream.headers.Range, "bytes=10-19")
  assert.equal(upstream.headers["If-Range"], '"audio-v1"')
  assert.equal(upstream.headers.Authorization, undefined)
  assert.equal(upstream.headers.Cookie, undefined)
  const head = await request(`/api/podcasts/audio?id=${id}`, { token: tokenA, method: "HEAD" })
  assert.equal(head.status, 200); assert.equal(head.headers.get("content-length"), "36"); assert.equal(await head.text(), "")
  const unsatisfied = await request(`/api/podcasts/audio?id=${id}`, { token: tokenA, headers: { Range: "bytes=999-" } })
  assert.equal(unsatisfied.status, 416); assert.equal(unsatisfied.headers.get("content-range"), "bytes */36")
  assert.equal(unsatisfied.headers.get("content-length"), "0"); assert.equal(await unsatisfied.text(), "")
  assert.equal((await request(`/api/podcasts/audio?id=${id}`, { token: tokenA, headers: { Range: "bytes=0-1,4-5" } })).status, 400)
})

test("podcast artwork proxy uses catalogue metadata and rejects active image types", async (t) => {
  const fixture = fixtureRequest()
  const { profiles, podcasts, a, request, tokenA } = await setup(t)
  const data = await podcasts.importFeed(a.id, feedUrl)
  const response = await request(`/api/podcasts/artwork?id=${encodeURIComponent(data.podcast.id)}`, { token: tokenA })
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "image/png")
  assert.equal(response.headers.get("x-content-type-options"), "nosniff")
  assert.equal((await request("/api/podcasts/artwork?url=https://foreign.example", { token: tokenA })).status, 400)
  const uncached = createPodcastService({ db: profiles.db, request: (url, options) => url === imageUrl ? remote("<svg/>", { headers: { "content-type": "image/svg+xml" } }) : fixture(url, options) })
  await assert.rejects(uncached.getArtwork(data.podcast.id), { status: 502 })
})

test("podcast artwork serves a binary-labelled JPEG as image/jpeg and caches the verified image", async (t) => {
  const jpeg = Buffer.from("ffd8ffe000104a46494600010100000100010000ffd9", "hex")
  const fixture = fixtureRequest(), calls = []
  const { podcasts, a, request, tokenA } = await setup(t, { request: (url, options) => {
    if (url !== imageUrl) return fixture(url, options)
    calls.push(url)
    return remote(jpeg, { headers: { "content-type": "application/octet-stream", "content-length": String(jpeg.length) } })
  } })
  const data = await podcasts.importFeed(a.id, feedUrl), path = `/api/podcasts/artwork?id=${encodeURIComponent(data.podcast.id)}`
  const responses = await Promise.all([request(path, { token: tokenA }), request(path, { token: tokenA })])
  for (const response of responses) {
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "image/jpeg")
    assert.equal(response.headers.get("content-length"), String(jpeg.length))
    assert.equal(response.headers.get("x-content-type-options"), "nosniff")
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg)
  }
  assert.equal((await request(path, { token: tokenA })).status, 200)
  assert.equal(calls.length, 1)
})

test("generic and missing artwork types require a recognised raster signature, never a URL extension", async (t) => {
  const { profiles, podcasts, a } = await setup(t)
  const data = await podcasts.importFeed(a.id, feedUrl), fixture = fixtureRequest()
  const formats = [
    ["image/jpeg", Buffer.from("ffd8ffe000", "hex")],
    ["image/png", Buffer.from("89504e470d0a1a0a00000000", "hex")],
    ["image/gif", Buffer.from("GIF89a" + "\0".repeat(8))],
    ["image/webp", Buffer.from("RIFF" + "\0".repeat(4) + "WEBPVP8 ")],
    ["image/avif", Buffer.from("00000018667479706176696600000000", "hex")],
  ]
  for (const [expected, bytes] of formats) {
    for (const header of [undefined, " Application/Octet-Stream ; charset=binary", "binary/octet-stream"]) {
      const service = createPodcastService({ db: profiles.db, request: (url, options) => url === imageUrl ? remote(bytes, { headers: header ? { "content-type": header } : {} }) : fixture(url, options) })
      const image = await service.getArtwork(data.podcast.id)
      assert.equal(image.mimeType, expected)
      assert.deepEqual(image.body, bytes)
    }
  }
  for (const [body, type] of [["<svg xmlns='http://www.w3.org/2000/svg'/>", "application/octet-stream"], ["<html>oops</html>", "application/octet-stream"], ["not an image", undefined], [formats[0][1], "image/svg+xml"], ["RIFFxxxxWAVE", "application/octet-stream"]]) {
    const service = createPodcastService({ db: profiles.db, request: (url, options) => url === imageUrl ? remote(body, { headers: type ? { "content-type": type } : {} }) : fixture(url, options) })
    await assert.rejects(service.getArtwork(data.podcast.id), { status: 502 })
  }
})

test("binary artwork keeps the size cap and rejects empty bodies", async (t) => {
  const { profiles, podcasts, a } = await setup(t)
  const data = await podcasts.importFeed(a.id, feedUrl), fixture = fixtureRequest()
  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1)
  Buffer.from("ffd8ff", "hex").copy(oversized)
  for (const body of [oversized, Buffer.alloc(0)]) {
    const service = createPodcastService({ db: profiles.db, request: (url, options) => url === imageUrl ? remote(body, { headers: { "content-type": "application/octet-stream" } }) : fixture(url, options) })
    await assert.rejects(service.getArtwork(data.podcast.id), { status: 502 })
  }
})

test("progress rejects invalid values, preserves the last valid position and clamps to duration", async (t) => {
  const { podcasts, a } = await setup(t)
  const data = await podcasts.importFeed(a.id, feedUrl), id = data.episodes[0].id
  for (const value of [{}, { position: -1 }, { position: NaN }, { duration: Infinity }, { completed: "yes" }, { position: 2, expectedRevision: -1 }, { userId: "other", position: 2 }]) assert.throws(() => podcasts.saveProgress(a.id, id, value), { status: 400 })
  assert.equal(podcasts.getProgress(a.id, id).revision, 0)
  const saved = podcasts.saveProgress(a.id, id, { position: 5000, duration: 3600 })
  assert.equal(saved.position, 3600)
  assert.equal(saved.completed, false) // Seeking does not silently mark the episode played.
})

test("the proxy refuses HTML media and malformed partial responses", async (t) => {
  let invalidRange = false
  const fixture = fixtureRequest()
  const { podcasts, a } = await setup(t, { request: (url, options) => url === audioUrl ? remote("bad", { status: invalidRange ? 206 : 200, headers: { "content-type": invalidRange ? "audio/mpeg" : "text/html" } }) : fixture(url, options) })
  const data = await podcasts.importFeed(a.id, feedUrl), id = data.episodes[0].id
  await assert.rejects(podcasts.openAudio(id, { method: "GET" }), { status: 502 })
  invalidRange = true
  await assert.rejects(podcasts.openAudio(id, { method: "GET", range: "bytes=0-2" }), { status: 502 })
})

test("invalid inputs fail before outbound calls and unknown episodes do not create progress", async (t) => {
  const { request, tokenA, calls } = await setup(t)
  for (const path of ["search?q=", "search?q=test&limit=0", "search?q=test&kind=song", "search?q=test&country=Spain", "show?id=x", "listening?completed=maybe", "listening?offset=-1"]) assert.equal((await request(`/api/podcasts/${path}`, { token: tokenA })).status, 400)
  assert.equal((await request("/api/podcasts/stream", { token: tokenA, method: "POST", body: {} })).status, 400)
  assert.equal((await request("/api/podcasts/feeds", { token: tokenA, method: "POST", body: { url: "http://127.0.0.1/secret" } })).status, 400)
  const unknown = "episode:" + "a".repeat(40)
  assert.equal((await request(`/api/podcasts/progress?id=${unknown}`, { token: tokenA, method: "PUT", body: { position: 2 } })).status, 404)
  assert.equal(calls.length, 0)
})

test("search errors are not cached as emptiness and directory calls have a shared limit", async (t) => {
  let failing = true, calls = 0
  const { podcasts, a } = await setup(t, { request: async () => { calls++; return failing ? remote("bad", { status: 503 }) : remote(JSON.stringify({ results: [appleEpisode] })) } })
  await assert.rejects(podcasts.search(a.id, { q: "retry", kind: "episodes" }), { status: 502 })
  failing = false
  assert.equal((await podcasts.search(a.id, { q: "retry", kind: "episodes" })).episodes.length, 1)
  for (let i = 0; i < 16; i++) await podcasts.search(a.id, { q: `different ${i}`, kind: "episodes" })
  await assert.rejects(podcasts.search(a.id, { q: "over-limit", kind: "episodes" }), { status: 429 })
  assert.equal(calls, 18)
})

test("progress survives database reopen and migrating a pre-podcast database preserves accounts", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "decibel-podcast-")), path = join(dir, "profiles.db")
  t.after(() => rm(dir, { recursive: true, force: true }))
  let db = openDb(path)
  const user = await createAccounts(db).createUser({ username: "Persist", password: "keep-password" })
  // Simulate the exact pre-podcast schema version, retaining existing account data.
  db.exec("DROP TABLE podcast_follows; DROP TABLE podcast_progress; DROP TABLE podcast_episodes; DROP TABLE podcast_shows; PRAGMA user_version = 1;")
  db.close(); db = openDb(path)
  assert.ok((await createAccounts(db).login("Persist", "keep-password")).user.id === user.id)
  let podcasts = createPodcastService({ db, request: fixtureRequest() })
  const data = await podcasts.importFeed(user.id, feedUrl), id = data.episodes[0].id
  podcasts.saveProgress(user.id, id, { position: 300, completed: false })
  db.close(); db = openDb(path)
  podcasts = createPodcastService({ db, request: fixtureRequest() })
  assert.equal(podcasts.getProgress(user.id, id).position, 300)
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 4)
  db.close()
})
