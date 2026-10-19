import assert from "node:assert/strict"
import { once } from "node:events"
import { test } from "node:test"
import { openDb } from "./db.mjs"
import { createApp } from "./index.mjs"
import { createProfileApi } from "./profile-api.mjs"
import { MAX_RECENT } from "./recent-searches.mjs"

const music = { health: async () => ({ ok: true }) }
const track = (id) => ({ id, title: `Tema ${id}`, artist: "A", album: "B", coverArt: `https://img/${id}.jpg`, duration: 100 })

async function setup(t) {
  let clock = 1_000_000
  // Test profiles: password = name (the server itself only bootstraps one admin).
  const seed = [{ username: "Alex", role: "admin", color: "#1db954", password: "Alex" }, { username: "Blanca", role: "user", color: "#e8115b", password: "Blanca" }]
  const profiles = await createProfileApi({ db: openDb(":memory:"), seed, now: () => clock })
  const app = await createApp({ music, profiles })
  app.listen(0, "127.0.0.1")
  await once(app, "listening")
  t.after(() => new Promise((resolve) => { app.close(resolve); app.closeAllConnections() }))
  const base = `http://127.0.0.1:${app.address().port}`
  const call = async (path, { token, method = "GET", body } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, cache: response.headers.get("cache-control"), body: await response.json().catch(() => null) }
  }
  const login = async (username) => (await call("/api/auth/login", { method: "POST", body: { username, password: username } })).body.token
  return { call, login, tick: (ms = 1000) => (clock += ms), now: () => clock }
}

const ids = (list) => list.map((row) => row.item.id)

test("recent searches: per profile, newest first, no duplicates, full item kept", async (t) => {
  const { call, login, tick, now } = await setup(t)
  const phone = await login("Alex"), pc = await login("Alex"), other = await login("Blanca")
  assert.equal((await call("/api/me/searches?source=ytdlp")).status, 401)
  for (const id of ["a", "b", "c"]) { tick(); await call("/api/me/searches", { token: phone, method: "POST", body: { source: "ytdlp", kind: "track", item: track(id), at: now() } }) }
  tick()
  const again = await call("/api/me/searches", { token: pc, method: "POST", body: { source: "ytdlp", kind: "track", item: track("a"), at: now() } })
  assert.deepEqual(ids(again.body), ["a", "c", "b"], "a repeated search moves to the top")
  const list = (await call("/api/me/searches?source=ytdlp", { token: phone })).body
  assert.deepEqual(ids(list), ["a", "c", "b"], "the other device of the profile sees the same list")
  assert.equal((await call("/api/me/searches?source=ytdlp", { token: phone })).cache, "no-store", "never cached by a browser, WebView or CDN")
  assert.equal(list[0].item.coverArt, "https://img/a.jpg")
  assert.equal(list[0].kind, "track")
  assert.equal((await call("/api/me/searches?source=ytdlp", { token: other })).body.length, 0, "isolated per profile")
  assert.equal((await call("/api/me/searches?source=mock", { token: phone })).body.length, 0, "and per source")
  assert.equal((await call("/api/me/searches", { token: phone, method: "POST", body: { source: "ytdlp", kind: "playlist", item: track("x") } })).status, 400)
  assert.equal((await call("/api/me/searches", { token: phone, method: "POST", body: { source: "ytdlp", kind: "track", item: { title: "sin id" } } })).status, 400)
})

test("recent searches: bounded, delete one or all, offline queues converge", async (t) => {
  const { call, login, tick, now } = await setup(t)
  const token = await login("Alex")
  const ops = Array.from({ length: MAX_RECENT + 5 }, (_, i) => ({ op: "add", kind: "track", item: track(`t${i}`), at: now() + i }))
  tick(100)
  const many = await call("/api/me/searches", { token, method: "POST", body: { source: "ytdlp", ops } })
  assert.equal(many.body.length, MAX_RECENT)
  assert.equal(many.body[0].item.id, `t${MAX_RECENT + 4}`)
  tick()
  const removed = await call("/api/me/searches", { token, method: "DELETE", body: { source: "ytdlp", kind: "track", id: `t${MAX_RECENT + 4}`, at: now() } })
  assert.equal(removed.body.length, MAX_RECENT - 1)
  assert.ok(!ids(removed.body).includes(`t${MAX_RECENT + 4}`))
  // A late queue from an offline device: its old search must not come back after the later delete,
  // but searching it again afterwards works.
  tick()
  const late = await call("/api/me/searches", { token, method: "POST", body: { source: "ytdlp", ops: [
    { op: "add", kind: "track", item: track(`t${MAX_RECENT + 4}`), at: now() - 5000 },
  ] } })
  assert.ok(!ids(late.body).includes(`t${MAX_RECENT + 4}`), "a delete propagates over older queued searches")
  const again = await call("/api/me/searches", { token, method: "POST", body: { source: "ytdlp", kind: "track", item: track(`t${MAX_RECENT + 4}`), at: now() } })
  assert.equal(again.body[0].item.id, `t${MAX_RECENT + 4}`, "searched again after the delete")
  tick()
  const cleared = await call("/api/me/searches", { token, method: "DELETE", body: { source: "ytdlp", at: now() } })
  assert.deepEqual(cleared.body, [])
  const resurrect = await call("/api/me/searches", { token, method: "POST", body: { source: "ytdlp", ops: [{ op: "add", kind: "track", item: track("old"), at: now() - 10 }] } })
  assert.deepEqual(resurrect.body, [], "searches older than a «clear all» stay cleared")
  tick()
  const fresh = await call("/api/me/searches", { token, method: "POST", body: { source: "ytdlp", kind: "query", item: { id: "rosalía", title: "rosalía" }, at: now() + 999_999 } })
  assert.deepEqual(ids(fresh.body), ["rosalía"])
  assert.ok(fresh.body[0].at <= now(), "client clocks in the future are clamped")
})
