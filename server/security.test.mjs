import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createApp } from "./index.mjs"
import { createProfileApi } from "./profile-api.mjs"
import { createLoginLimiter } from "./login-limiter.mjs"
import { createRequestSecurity } from "./request-security.mjs"
import { MusicError } from "./errors.mjs"

async function fixture(t, { profileOptions = {}, appOptions = {} } = {}) {
  const profiles = await createProfileApi({ seed: false, ...profileOptions })
  const admin = await profiles.accounts.createUser({ username: "Audit Admin", password: "fixture-password", role: "admin" })
  const user = await profiles.accounts.createUser({ username: "Audit User", password: "fixture-password" })
  const app = await createApp({ profiles, music: { health: async () => ({ ok: true }) }, ...appOptions })
  app.listen(0, "127.0.0.1"); await once(app, "listening")
  t.after(async () => { await new Promise((done) => { app.close(done); app.closeAllConnections() }); profiles.db.close() })
  const base = `http://127.0.0.1:${app.address().port}`
  const call = (path, { method = "GET", body, headers = {}, token } = {}) => fetch(base + path, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const login = (headers = {}) => call("/api/auth/login", { method: "POST", body: { username: admin.name, password: "fixture-password" }, headers })
  return { profiles, app, base, admin, user, call, login }
}

test("forwarded IP and protocol require an explicitly trusted immediate proxy", () => {
  const req = { socket: { remoteAddress: "127.0.0.1" }, headers: { host: "localhost:3000", "cf-connecting-ip": "192.0.2.1", "x-forwarded-proto": "https" } }
  const direct = createRequestSecurity({ trustProxy: false })
  assert.equal(direct.clientIp(req), "127.0.0.1")
  assert.equal(direct.isHttps(req), false)
  const local = createRequestSecurity({ trustProxy: true })
  assert.equal(local.clientIp(req), "192.0.2.1")
  assert.equal(local.isHttps(req), true)
  req.socket.remoteAddress = "192.0.2.2"
  assert.equal(local.clientIp(req), "192.0.2.2")
  assert.equal(local.isHttps(req), false)
  const selected = createRequestSecurity({ trustProxy: "192.0.2.2" })
  assert.equal(selected.clientIp(req), "192.0.2.1")
  req.headers["cf-connecting-ip"] = "192.0.2.1, 192.0.2.3"
  assert.equal(selected.clientIp(req), "192.0.2.2")
  req.socket.encrypted = true
  assert.equal(direct.isHttps(req), true)
  assert.throws(() => createRequestSecurity({ trustProxy: "anywhere" }))
})

test("cookies ignore untrusted forwarded protocol and are Secure behind a trusted HTTPS proxy", async (t) => {
  for (const trusted of [false, true]) {
    const { login, call } = await fixture(t, { profileOptions: { trustProxy: trusted }, appOptions: { trustProxy: trusted } })
    const response = await login({ "X-Forwarded-Proto": "https" })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("set-cookie").includes("; Secure"), trusted)
    const { token } = await response.json()
    const logout = await call("/api/auth/logout", { token, method: "POST", headers: { "X-Forwarded-Proto": "https" } })
    assert.equal(logout.headers.get("set-cookie").includes("; Secure"), trusted)
  }
})

test("rate limits include in-flight attempts, expire, and do not lock a name across other peers", () => {
  let now = 0
  const limiter = createLoginLimiter({ max: 3, perName: 2, maxConcurrent: 2, now: () => now, windowMs: 1000 })
  const a = limiter.begin("peer-a", "Admin"), b = limiter.begin("peer-a", " admin ")
  assert.equal(a.wait, 0); assert.equal(b.wait, 0)
  assert.ok(limiter.begin("peer-a", "Admin").wait)
  a.finish(false); b.finish(false); b.finish(false)
  assert.ok(limiter.begin("peer-a", "Admin").wait)
  const other = limiter.begin("peer-b", "Admin")
  assert.equal(other.wait, 0); other.finish(true)
  now += 1000
  assert.equal(limiter.begin("peer-a", "Admin").wait, 0)
})

test("limiter bounds bucket storage and successful logins cannot clear another name's failures", () => {
  let now = 0
  const limiter = createLoginLimiter({ max: 2, perName: 2, maxEntries: 4, windowMs: 1000, now: () => now })
  limiter.begin("peer", "admin").finish(false)
  limiter.begin("peer", "user").finish(true)
  limiter.begin("peer", "admin").finish(false)
  assert.ok(limiter.begin("peer", "admin").wait)
  assert.ok(limiter.begin("other-peer", "different").wait)
  now = 1000
  assert.equal(limiter.begin("other-peer", "different").wait, 0)
})

test("spoofed client-IP headers and parallel requests cannot bypass login admission", async (t) => {
  const { profiles, call } = await fixture(t, { profileOptions: { limiter: createLoginLimiter({ max: 2, perName: 2 }) } })
  let entered = 0
  profiles.accounts.login = async () => { entered++; await new Promise((done) => setTimeout(done, 80)); return null }
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => call("/api/auth/login", { method: "POST", body: { username: `Guess ${i}`, password: "bad" }, headers: { "CF-Connecting-IP": `192.0.2.${i + 1}` } })))
  assert.equal(entered, 2)
  assert.equal(responses.filter((r) => r.status === 401).length, 2)
  assert.equal(responses.filter((r) => r.status === 429).length, 10)
  assert.ok(responses.filter((r) => r.status === 429).every((r) => Number(r.headers.get("retry-after")) > 0))
})

test("public health requests share work and cache success and failure for bounded intervals", async (t) => {
  let now = 0, count = 0, failing = false
  const { call } = await fixture(t, { appOptions: { now: () => now, music: { health: async () => { count++; await new Promise((done) => setTimeout(done, 10)); if (failing) throw new MusicError("Fixture unavailable", 502); return { ok: true } } } } })
  const responses = await Promise.all(Array.from({ length: 16 }, () => call("/api/music/health")))
  assert.ok(responses.every((r) => r.status === 200)); assert.equal(count, 1)
  now = 29_999; await call("/api/music/health"); assert.equal(count, 1)
  now = 30_000; failing = true
  assert.equal((await call("/api/music/health")).status, 502)
  await call("/api/music/health"); assert.equal(count, 2)
  now += 5000; failing = false
  assert.equal((await call("/api/music/health")).status, 200); assert.equal(count, 3)
})

test("CORS requires the full origin or explicit allowlist, including native preflight", async (t) => {
  const { base, call } = await fixture(t, { appOptions: { allowedOrigins: ["https://tauri.localhost"] } })
  assert.equal((await call("/api/health", { headers: { Origin: base } })).status, 200)
  for (const origin of ["https://127.0.0.1", "http://127.0.0.1:1", "https://foreign.example", "null"]) assert.equal((await call("/api/health", { headers: { Origin: origin } })).status, 403)
  const preflight = await call("/api/podcasts/audio", { method: "OPTIONS", headers: { Origin: "https://tauri.localhost", "Access-Control-Request-Headers": "Authorization, Range" } })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://tauri.localhost")
})

test("invalid profile patch values cannot bypass the last-admin invariant or reset its password", async (t) => {
  const { profiles, admin, user, call, login } = await fixture(t)
  const { token } = await (await login()).json(), userToken = profiles.accounts.createSession(user.id)
  const path = `/api/admin/users/${admin.id}`
  assert.equal((await call(path, { token: userToken, method: "PATCH", body: { role: "admin" } })).status, 403)
  for (const body of [{ active: 0 }, { active: null }, { active: "false" }, { role: "invalid" }, { role: 0 }, { active: 0, password: "replacement-password" }]) {
    assert.equal((await call(path, { token, method: "PATCH", body })).status, 400)
    assert.equal(profiles.accounts.get(admin.id).active, 1)
    assert.equal(profiles.accounts.get(admin.id).role, "admin")
  }
  assert.equal((await login()).status, 200)
  assert.equal((await call(path, { token, method: "PATCH", body: { role: "user" } })).status, 409)

  // A failed combined edit must not reset the password or revoke other sessions first.
  const previousHash = profiles.accounts.get(admin.id).password_hash
  const secondSession = profiles.accounts.createSession(admin.id)
  for (const body of [{ role: "user", password: "replacement-password" }, { active: false, password: "replacement-password" }]) {
    assert.equal((await call(path, { token, method: "PATCH", body })).status, 409)
    assert.equal(profiles.accounts.get(admin.id).password_hash, previousHash)
    assert.ok(profiles.accounts.session(secondSession))
  }
  assert.equal((await login()).status, 200)
})

test("invalid JSON, credential types and cookies fail cleanly without verifying a password", async (t) => {
  const { profiles, call } = await fixture(t)
  profiles.accounts.login = () => assert.fail("No password verification for malformed input")
  for (const body of [null, [], { username: "Admin", password: {} }, { username: {}, password: "test" }]) assert.equal((await call("/api/auth/login", { method: "POST", body })).status, 400)
  assert.equal((await call("/api/auth/me", { headers: { Cookie: "decibel_session=%" } })).status, 400)
})

test("static serving does not expose files outside publicDir or bypass API authentication", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "decibel-security-")), publicDir = join(directory, "public")
  t.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(publicDir); await writeFile(join(publicDir, "index.html"), "Public fixture")
  const sentinel = "private-audit-fixture"
  await writeFile(join(directory, "private.txt"), sentinel)
  const { call } = await fixture(t, { appOptions: { publicDir } })
  for (const path of ["/%2e%2e%2fprivate.txt", "/.git/config", "/.env.local", "/data/decibel.db"]) {
    const response = await call(path)
    assert.notEqual(await response.text(), sentinel)
    assert.ok([400, 404].includes(response.status))
  }
  for (const path of ["/api/admin/users", "/api/me/history?source=mock", "/api/playlists?source=mock", "/api/podcasts/artwork?id=x", "/api/podcasts/top", "/api/music/search?q=test"]) assert.equal((await call(path)).status, 401)
})
