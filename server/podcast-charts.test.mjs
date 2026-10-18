import assert from "node:assert/strict"
import { once } from "node:events"
import test from "node:test"
import { openDb } from "./db.mjs"
import { createApp } from "./index.mjs"
import { createProfileApi } from "./profile-api.mjs"
import { createPodcastService } from "./podcasts.mjs"
import { appleShow, feedUrl, remote, rss } from "../tests/fixtures/podcasts.mjs"

const SIX_HOURS = 6 * 60 * 60_000
const updated = "2026-10-18T12:00:00Z"

function fixture() {
  const calls = []
  const row = (id, feed = `https://feeds.example/${id}.xml`) => ({ ...appleShow, collectionId: id, trackId: id, collectionName: `Programa ${id}`, feedUrl: feed })
  const state = {
    clock: Date.parse(updated), updated, offline: false, primaryFails: false, lookupFails: false,
    general: [102, 101, 103, 104, 105, 102],
    categories: { "1303": [101, 102], "1489": [], "1488": null, "1324": [102], "1545": [105], "1487": [101] },
    // Lookup order differs from ranking; missing/private feeds and duplicate feeds must disappear.
    rows: [row(105, "http://127.0.0.1/private"), row(104, feedUrl), row(103, undefined), row(101, feedUrl), row(102)],
  }
  delete state.rows[2].feedUrl
  const request = async (value, options) => {
    const url = new URL(value)
    calls.push({ url, ...options })
    if (state.offline) throw new TypeError("offline")
    if (value === feedUrl) return remote(rss)
    if (url.pathname === "/search") return remote(JSON.stringify({ results: [state.rows.find((row) => row.collectionId === 101)] }))
    if (url.pathname === "/lookup") return remote(JSON.stringify({ results: state.rows }), { status: state.lookupFails ? 503 : 200 })
    const modern = url.hostname === "rss.marketingtools.apple.com"
    if (modern && state.primaryFails) return remote("unavailable", { status: 503 })
    const genre = url.pathname.match(/genre=(\d+)/)?.[1]
    const ids = genre ? state.categories[genre] : state.general
    if (ids === null) return remote("unavailable", { status: 503 })
    const entries = ids.map((id) => modern ? { id: String(id) } : { id: { attributes: { "im:id": String(id) } } })
    return remote(JSON.stringify({ feed: modern
      ? { updated: state.updated, results: entries }
      : { updated: { label: state.updated }, entry: entries.length === 1 ? entries[0] : entries } }))
  }
  return { calls, state, request }
}

function service(t, source = fixture()) {
  const db = openDb(":memory:")
  t.after(() => db.close())
  const podcasts = createPodcastService({ db, request: source.request, now: () => source.state.clock })
  return { ...source, db, podcasts }
}

test("top preserves chart order, maps lookup IDs to canonical searchable/openable shows, and omits unusable sections", async (t) => {
  const { podcasts, calls, db } = service(t)
  const top = await podcasts.getTop("es")
  assert.equal(top.country, "ES")
  assert.equal(top.source, "apple-charts")
  assert.equal(top.updatedAt, Date.parse(updated))
  assert.deepEqual(top.sections.map((s) => [s.id, s.title]), [["all", "Más escuchados"], ["1303", "Comedia"], ["1324", "Sociedad y cultura"], ["1487", "Historia"]])
  assert.deepEqual(top.sections[0].podcasts.map((p) => p.title), ["Programa 102", "Programa 101"])
  assert.deepEqual(top.sections[1].podcasts.map((p) => p.title), ["Programa 101", "Programa 102"])
  const podcast = top.sections[0].podcasts[1]
  assert.match(podcast.id, /^podcast:[a-f0-9]{32}$/)
  assert.equal(podcast.author, appleShow.artistName)
  assert.equal(podcast.coverArt, appleShow.artworkUrl600)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM podcast_shows").get().n, 2)
  const lookup = calls.find((c) => c.url.pathname === "/lookup")
  assert.equal(lookup.url.searchParams.get("country"), "ES")
  assert.deepEqual(lookup.url.searchParams.get("id").split(","), ["102", "101", "103", "104", "105"])
  assert.ok(calls.every((c) => c.signal && !c.headers.Authorization && !c.headers.Cookie))
  const search = await podcasts.search("profile", { q: "programa", kind: "podcasts" })
  assert.equal(search.podcasts[0].id, podcast.id)
  const page = await podcasts.getShow("profile", podcast.id)
  assert.equal(page.episodes.length, 2)
  assert.equal(page.podcast.id, podcast.id)
})

test("concurrent requests share one refresh per country and hits make no upstream calls", async (t) => {
  const { podcasts, calls } = service(t)
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => podcasts.getTop(i % 2 ? "es" : "ES")))
  assert.ok(responses.every((value) => value === responses[0]))
  assert.equal(calls.length, 8) // Seven charts and one batched lookup, across all callers/profiles.
  assert.deepEqual(await podcasts.getTop(), responses[0])
  assert.equal(calls.length, 8)
})

test("countries have separate caches and a dedicated refresh budget with Retry-After", async (t) => {
  const { podcasts, state, calls } = service(t)
  const es = await podcasts.getTop(), gb = await podcasts.getTop("gb")
  assert.equal(gb.country, "GB")
  assert.ok(calls.some((c) => c.url.pathname.includes("/gb/")))
  assert.ok(calls.some((c) => c.url.pathname === "/lookup" && c.url.searchParams.get("country") === "GB"))
  await assert.rejects(podcasts.getTop("FR"), (e) => e.status === 503 && e.retryAfter === 60)
  assert.deepEqual(await podcasts.getTop("ES"), es)
  state.clock += 60_000
  assert.equal((await podcasts.getTop("FR")).country, "FR")
})

test("six-hour expiry refreshes charts; outages preserve the last valid ranking and back off", async (t) => {
  const { podcasts, state, calls } = service(t)
  const first = await podcasts.getTop()
  state.clock += SIX_HOURS - 1
  assert.deepEqual(await podcasts.getTop(), first)
  assert.equal(calls.length, 8)
  state.clock += 1
  state.updated = new Date(state.clock).toISOString()
  state.general = [101, 102]
  const refreshed = await podcasts.getTop()
  assert.equal(calls.length, 16)
  assert.equal(refreshed.updatedAt, state.clock)
  assert.deepEqual(refreshed.sections[0].podcasts.map((p) => p.title), ["Programa 101", "Programa 102"])
  state.clock += SIX_HOURS
  state.offline = true
  const stale = await podcasts.getTop()
  assert.deepEqual(stale, refreshed)
  const count = calls.length
  assert.deepEqual(await podcasts.getTop(), stale)
  assert.equal(calls.length, count)
  state.clock += 60_000
  assert.deepEqual(await podcasts.getTop(), stale)
  assert.ok(calls.length > count)
})

test("the general chart falls back to legacy Apple RSS, including singleton entries", async (t) => {
  const { podcasts, state, calls } = service(t)
  state.primaryFails = true
  state.general = [101]
  const top = await podcasts.getTop()
  assert.deepEqual(top.sections[0].podcasts.map((p) => p.title), ["Programa 101"])
  assert.equal(top.updatedAt, Date.parse(updated))
  assert.ok(calls.some((c) => c.url.pathname === "/es/rss/toppodcasts/limit=25/json"))
})

test("usable categories survive an unavailable general chart", async (t) => {
  const { podcasts, state } = service(t)
  state.general = []
  const top = await podcasts.getTop()
  assert.equal(top.sections[0].id, "1303")
  assert.equal(top.updatedAt, Date.parse(updated))
})

test("cold outages and malformed upstream JSON return Spanish 502 errors without caching emptiness", async (t) => {
  const { podcasts, state, db } = service(t)
  state.offline = true
  await assert.rejects(podcasts.getTop(), (e) => e.status === 502 && /ranking de podcasts no está disponible/.test(e.message))
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM podcast_shows").get().n, 0)
  state.offline = false
  assert.ok((await podcasts.getTop()).sections.length)
  const malformed = fixture(), delegate = malformed.request
  malformed.request = (url, options) => new URL(url).pathname === "/lookup" ? remote("not JSON") : delegate(url, options)
  const other = service(t, malformed)
  await assert.rejects(other.podcasts.getTop(), { status: 502 })
})

test("lookup failures and empty/unplayable charts never replace the last valid cache", async (t) => {
  const { podcasts, state } = service(t)
  const valid = await podcasts.getTop()
  state.clock += SIX_HOURS
  state.lookupFails = true
  assert.deepEqual(await podcasts.getTop(), valid)
  state.clock += 60_000
  state.lookupFails = false
  state.rows = []
  assert.deepEqual(await podcasts.getTop(), valid)
  const cold = service(t)
  cold.state.rows = []
  await assert.rejects(cold.podcasts.getTop(), { status: 502 })
})

test("a missing Apple timestamp uses fetch time and invalid countries make no upstream calls", async (t) => {
  const { podcasts, state, calls } = service(t)
  for (const country of ["", "Spain", "E1", null, ["ES"]]) await assert.rejects(podcasts.getTop(country), { status: 400 })
  assert.equal(calls.length, 0)
  state.updated = "invalid"
  assert.equal((await podcasts.getTop()).updatedAt, state.clock)
})

test("rankings work after exhausting search and do not consume its 18/min budget", async (t) => {
  const { podcasts } = service(t)
  for (let i = 0; i < 18; i++) await podcasts.search("profile", { q: `query ${i}`, kind: "podcasts" })
  await assert.rejects(podcasts.search("profile", { q: "over limit", kind: "podcasts" }), { status: 429 })
  assert.ok((await podcasts.getTop()).sections.length)
  const fresh = service(t)
  await fresh.podcasts.getTop()
  for (let i = 0; i < 18; i++) await fresh.podcasts.search("profile", { q: `query ${i}`, kind: "podcasts" })
})

test("HTTP top requires cookie/Bearer auth and returns the agreed shape and 400/405/502/503 errors", async (t) => {
  const profiles = await createProfileApi({ seed: false }), source = fixture()
  const user = await profiles.accounts.createUser({ username: "Top listener", password: "fixture-password" })
  const token = profiles.accounts.createSession(user.id)
  const podcasts = createPodcastService({ db: profiles.db, request: source.request, now: () => source.state.clock })
  const app = await createApp({ profiles, podcasts })
  app.listen(0, "127.0.0.1"); await once(app, "listening")
  t.after(async () => { await new Promise((done) => { app.close(done); app.closeAllConnections() }); profiles.db.close() })
  const base = `http://127.0.0.1:${app.address().port}/api/podcasts/top`
  const request = (query = "", headers = { Authorization: `Bearer ${token}` }, method = "GET") => fetch(base + query, { headers, method })
  assert.equal((await request("", {})).status, 401)
  assert.equal((await request("", { Authorization: "Bearer forged" })).status, 401)
  assert.equal(source.calls.length, 0)
  const cookie = await request("?country=es", { Cookie: `decibel_session=${token}` })
  assert.equal(cookie.status, 200)
  const body = await cookie.json()
  assert.deepEqual(Object.keys(body).sort(), ["country", "sections", "source", "updatedAt"])
  assert.deepEqual(await (await request()).json(), body)
  assert.equal(source.calls.length, 8)
  for (const country of ["", "España", "E1"]) assert.equal((await request(`?country=${encodeURIComponent(country)}`)).status, 400)
  assert.equal((await request("", undefined, "POST")).status, 405)
  source.state.offline = true
  const failed = await request("?country=GB")
  assert.equal(failed.status, 502)
  assert.match((await failed.json()).error, /ranking de podcasts/)
  const busy = await request("?country=FR")
  assert.equal(busy.status, 503)
  assert.equal(busy.headers.get("retry-after"), "60")
})
