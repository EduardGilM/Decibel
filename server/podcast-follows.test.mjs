import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createAccounts } from "./accounts.mjs"
import { openDb } from "./db.mjs"
import { createApp } from "./index.mjs"
import { createProfileApi } from "./profile-api.mjs"
import { createPodcastService } from "./podcasts.mjs"
import { feedUrl, fixtureRequest, remote, rss } from "../tests/fixtures/podcasts.mjs"

async function setup(t) {
  const profiles = await createProfileApi({ seed: false })
  const a = await profiles.accounts.createUser({ username: "Follow A", password: "follow-password-a" })
  const b = await profiles.accounts.createUser({ username: "Follow B", password: "follow-password-b" })
  const calls = [], fixture = fixtureRequest(calls)
  let clock = 1000
  const podcasts = createPodcastService({ db: profiles.db, now: () => clock, request: (url, options) => url === "https://feeds.example/second.xml" ? remote(rss.replace("<title>Conversaciones</title>", "<title>Otro programa</title>"), { url }) : fixture(url, options) })
  const app = await createApp({ profiles, podcasts })
  app.listen(0, "127.0.0.1"); await once(app, "listening")
  t.after(async () => { await new Promise((done) => { app.close(done); app.closeAllConnections() }); profiles.db.close() })
  const base = `http://127.0.0.1:${app.address().port}`
  const request = async (path, { token, method = "GET", headers = {} } = {}) => {
    const response = await fetch(base + "/api/podcasts/" + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } })
    return { status: response.status, body: await response.json() }
  }
  const tokenA = profiles.accounts.createSession(a.id), tokenB = profiles.accounts.createSession(b.id)
  return { profiles, podcasts, a, b, tokenA, tokenB, request, calls, tick: (value) => { clock = value } }
}

test("follows are per profile, ordered, idempotent, and do not erase listening progress", async (t) => {
  const { podcasts, a, tokenA, tokenB, request, calls, tick } = await setup(t)
  const first = await podcasts.importFeed(a.id, feedUrl), firstId = first.podcast.id
  assert.equal(first.following, false)
  const second = await podcasts.importFeed(a.id, "https://feeds.example/second.xml"), secondId = second.podcast.id
  const follow = (id) => `follows?id=${encodeURIComponent(id)}`
  const page = (id) => `show?id=${encodeURIComponent(id)}`
  assert.deepEqual((await request("follows", { token: tokenA })).body, { podcasts: [] })
  assert.deepEqual(await request(follow(firstId), { token: tokenA, method: "PUT" }), { status: 200, body: { following: true } })
  tick(2000)
  await request(follow(firstId), { token: tokenA, method: "PUT" })
  tick(3000)
  await request(follow(secondId), { token: tokenA, method: "PUT" })
  const followed = await request("follows", { token: tokenA })
  assert.deepEqual(followed.body.podcasts.map((p) => [p.id, p.followedAt]), [[secondId, 3000], [firstId, 1000]])
  assert.equal(followed.body.podcasts[1].title, "Conversaciones")
  assert.equal((await request(page(firstId), { token: tokenA })).body.following, true)
  assert.equal((await request(page(firstId), { token: tokenB })).body.following, false)
  assert.deepEqual((await request("follows", { token: tokenB })).body, { podcasts: [] })
  await request(follow(firstId), { token: tokenB, method: "PUT" })
  const episodeId = first.episodes[0].id
  podcasts.saveProgress(a.id, episodeId, { position: 80 })
  assert.deepEqual(await request(follow(firstId), { token: tokenA, method: "DELETE" }), { status: 200, body: { following: false } })
  assert.deepEqual(await request(follow(firstId), { token: tokenA, method: "DELETE" }), { status: 200, body: { following: false } })
  assert.equal((await request(page(firstId), { token: tokenA })).body.following, false)
  assert.equal((await request(page(firstId), { token: tokenB })).body.following, true)
  assert.equal(podcasts.getProgress(a.id, episodeId).position, 80)
  tick(4000)
  await request(follow(firstId), { token: tokenA, method: "PUT" })
  assert.deepEqual((await request("follows", { token: tokenA })).body.podcasts.map((p) => [p.id, p.followedAt]), [[firstId, 4000], [secondId, 3000]])
  assert.equal(calls.length, 1) // Reading or changing follows never requests the catalogue/feed.
})

test("follows require a cookie/Bearer session, validate IDs, and do not create unknown shows", async (t) => {
  const { a, podcasts, tokenA, request, calls } = await setup(t)
  for (const method of ["GET", "PUT", "DELETE"]) assert.equal((await request("follows?id=podcast:bad", { method })).status, 401)
  assert.equal((await request("follows", { token: "forged" })).status, 401)
  const imported = await podcasts.importFeed(a.id, feedUrl)
  const cookie = { Cookie: `decibel_session=${tokenA}` }
  assert.equal((await request(`follows?id=${encodeURIComponent(imported.podcast.id)}`, { headers: cookie, method: "PUT" })).status, 200)
  assert.equal((await request("follows", { headers: cookie })).body.podcasts.length, 1)
  for (const id of ["", "x", "episode:" + "a".repeat(40)]) {
    for (const method of ["PUT", "DELETE"]) assert.equal((await request(`follows?id=${id}`, { token: tokenA, method })).status, 400)
  }
  const unknown = "podcast:" + "f".repeat(32)
  assert.equal((await request(`follows?id=${unknown}`, { token: tokenA, method: "PUT" })).status, 404)
  assert.deepEqual((await request(`follows?id=${unknown}`, { token: tokenA, method: "DELETE" })).body, { following: false })
  assert.equal((await request("follows", { token: tokenA, method: "POST" })).status, 405)
  assert.equal(calls.length, 1)
})

test("migration 3 preserves version 2 podcast progress, and follows survive reopening SQLite", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "decibel-follows-")), path = join(dir, "profiles.db")
  t.after(() => rm(dir, { recursive: true, force: true }))
  let db = openDb(path)
  const user = await createAccounts(db).createUser({ username: "Existing", password: "same-password" })
  let podcasts = createPodcastService({ db, request: fixtureRequest(), now: () => 123456 })
  const imported = await podcasts.importFeed(user.id, feedUrl), episodeId = imported.episodes[0].id
  podcasts.saveProgress(user.id, episodeId, { position: 123.5 })
  db.exec("DROP TABLE podcast_follows; PRAGMA user_version = 2;")
  db.close(); db = openDb(path)
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 4)
  assert.equal((await createAccounts(db).login("Existing", "same-password")).user.id, user.id)
  podcasts = createPodcastService({ db, request: fixtureRequest(), now: () => 123456 })
  assert.equal(podcasts.getProgress(user.id, episodeId).position, 123.5)
  assert.deepEqual(podcasts.getFollows(user.id), { podcasts: [] })
  podcasts.setFollowing(user.id, imported.podcast.id, true)
  db.close(); db = openDb(path)
  podcasts = createPodcastService({ db, request: fixtureRequest() })
  assert.equal(podcasts.getFollows(user.id).podcasts[0].followedAt, 123456)
  assert.equal(podcasts.getProgress(user.id, episodeId).position, 123.5)
  db.close()
})
