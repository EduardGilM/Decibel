import assert from "node:assert/strict"
import { once } from "node:events"
import { test } from "node:test"
import { createLoginLimiter, hashPassword, verifyPassword } from "./accounts.mjs"
import { openDb } from "./db.mjs"
import { createApp } from "./index.mjs"
import { createProfileApi } from "./profile-api.mjs"

const music = { health: async () => ({ ok: true }), home: () => ({ albums: [] }), starred: () => ({ tracks: [] }) }
const track = (id, extra = {}) => ({ id, title: `Tema ${id}`, artist: "A", album: "B", duration: 100, ...extra })

/** Test profiles: password = name, created explicitly (the server itself only bootstraps one admin). */
const FAMILY = [
  { username: "Alex", role: "admin", color: "#1db954", password: "Alex" },
  { username: "Blanca", role: "user", color: "#e8115b", password: "Blanca" },
  { username: "Carlos", role: "user", color: "#2d46b9", password: "Carlos" },
  { username: "Dana", role: "user", color: "#f59b23", password: "Dana" },
]

async function setup(t, options = {}) {
  const profiles = await createProfileApi({ db: openDb(":memory:"), seed: FAMILY, ...options })
  const app = await createApp({ music, profiles })
  app.listen(0, "127.0.0.1")
  await once(app, "listening")
  t.after(() => new Promise((resolve) => { app.close(resolve); app.closeAllConnections() }))
  const base = `http://127.0.0.1:${app.address().port}`
  const call = async (path, { token, method = "GET", body, headers = {} } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers }
  }
  const login = async (username, password = username) => (await call("/api/auth/login", { method: "POST", body: { username, password } })).body
  const ids = Object.fromEntries(profiles.accounts.list().map((p) => [p.username, p.id]))
  return { profiles, call, login, ids }
}

test("passwords are scrypt-hashed and verified", async () => {
  const hash = await hashPassword("Blanca")
  assert.match(hash, /^scrypt\$/)
  assert.ok(!hash.includes("Blanca"))
  assert.equal(await verifyPassword("Blanca", hash), true)
  assert.equal(await verifyPassword("blanca", hash), false)
})

test("seeds the given profiles once, case-insensitive user name", async (t) => {
  const { call, login, profiles } = await setup(t)
  const row = profiles.db.prepare("SELECT password_hash FROM users WHERE username = 'Dana'").get()
  assert.ok(!row.password_hash.includes("Dana"))
  const session = await login("dana", "Dana")
  assert.equal(session.user.name, "Dana")
  assert.deepEqual((await call("/api/auth/profiles", { token: session.token })).body.map((p) => p.name), ["Alex", "Blanca", "Carlos", "Dana"])
  assert.equal((await call("/api/auth/login", { method: "POST", body: { username: "Dana", password: "dana" } })).status, 401)

  // Re-seeding never overwrites a changed password.
  await call("/api/auth/password", { method: "POST", token: session.token, body: { current: "Dana", next: "nueva-clave" } })
  assert.deepEqual(await profiles.accounts.seed(FAMILY), [])
  assert.equal((await call("/api/auth/login", { method: "POST", body: { username: "Dana", password: "Dana" } })).status, 401)
  assert.equal((await login("DANA", "nueva-clave")).user.weakPassword, false)
})

test("every /api route needs a session except login and health", async (t) => {
  const { call, login } = await setup(t)
  assert.equal((await call("/api/music/health")).status, 200)
  assert.deepEqual((await call("/api/health")).body, { ok: true, profiles: 4 })
  assert.equal((await call("/api/auth/profiles")).status, 401)
  assert.equal((await call("/api/music/home")).status, 401)
  assert.equal((await call("/api/music/stream", { method: "POST", body: { id: "x" } })).status, 401)
  assert.equal((await call("/api/me/likes?source=mock")).status, 401)
  assert.equal((await call("/api/whatever")).status, 401)
  const { token } = await login("Carlos")
  assert.equal((await call("/api/music/home", { token })).status, 200)
  assert.equal((await call("/api/music/home", { token: "forged" })).status, 401)
  // YouTube audio cannot be fetched for offline use.
  assert.equal((await call("/api/music/stream", { token, method: "POST", body: { id: "x" }, headers: { "X-Decibel-Purpose": "download" } })).status, 403)
})

test("profile names require a valid cookie or bearer session, including for non-admins", async (t) => {
  const { call, profiles } = await setup(t)
  assert.equal(profiles.isPublic("/api/auth/profiles"), false)
  for (const options of [{}, { token: "forged" }, { headers: { Cookie: "decibel_session=forged" } }]) {
    const response = await call("/api/auth/profiles", options)
    assert.equal(response.status, 401)
    assert.deepEqual(response.body, { error: "Inicia sesión para continuar." })
  }

  const login = await call("/api/auth/login", { method: "POST", body: { username: "Blanca", password: "Blanca" } })
  const cookie = login.headers.get("set-cookie").split(";")[0]
  for (const options of [{ token: login.body.token }, { headers: { Cookie: cookie } }]) {
    const response = await call("/api/auth/profiles", options)
    assert.equal(response.status, 200)
    assert.equal(response.body.length, 4)
    assert.ok(response.body.every((p) => Object.keys(p).sort().join(",") === "color,id,name"))
  }
  await call("/api/auth/logout", { method: "POST", token: login.body.token })
  assert.equal((await call("/api/auth/profiles", { token: login.body.token })).status, 401)
  assert.equal((await call("/api/auth/profiles", { headers: { Cookie: cookie } })).status, 401)
})

test("cookie session: HttpOnly, one year, cleared on logout", async (t) => {
  const { call } = await setup(t)
  const response = await call("/api/auth/login", { method: "POST", body: { username: "Alex", password: "Alex" } })
  const cookie = response.headers.get("set-cookie")
  assert.match(cookie, /decibel_session=[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=31536000/)
  const value = cookie.split(";")[0]
  assert.equal((await call("/api/auth/me", { headers: { Cookie: value } })).body.user.name, "Alex")
  await call("/api/auth/logout", { method: "POST", headers: { Cookie: value } })
  assert.equal((await call("/api/auth/me", { headers: { Cookie: value } })).status, 401)
})

test("sessions slide: renewed when used, expire after a year idle", async (t) => {
  let clock = Date.parse("2026-01-01")
  const { call } = await setup(t, { now: () => clock })
  const { token } = (await call("/api/auth/login", { method: "POST", body: { username: "Blanca", password: "Blanca" } })).body
  clock += 300 * 86_400_000
  assert.equal((await call("/api/auth/me", { token })).status, 200) // renews for another year
  clock += 300 * 86_400_000
  assert.equal((await call("/api/auth/me", { token })).status, 200)
  clock += 366 * 86_400_000
  assert.equal((await call("/api/auth/profiles", { token })).status, 401)
  assert.equal((await call("/api/auth/me", { token })).status, 401)
})

test("failed logins are rate-limited", async (t) => {
  const { call } = await setup(t, { limiter: createLoginLimiter({ perName: 3, max: 5 }) })
  for (let i = 0; i < 3; i++) assert.equal((await call("/api/auth/login", { method: "POST", body: { username: "Alex", password: "x" } })).status, 401)
  const blocked = await call("/api/auth/login", { method: "POST", body: { username: "Alex", password: "Alex" } })
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.headers.get("retry-after")) > 0)
})

test("admin manages profiles; others cannot", async (t) => {
  const { call, login, ids } = await setup(t)
  const admin = (await login("Alex")).token
  const user = (await login("Blanca")).token
  assert.equal((await call("/api/admin/users", { token: user })).status, 403)
  const me = (await call("/api/auth/me", { token: admin })).body
  assert.deepEqual(me.weakProfiles, ["Alex", "Blanca", "Carlos", "Dana"])

  const created = await call("/api/admin/users", { token: admin, method: "POST", body: { name: "Abuela", password: "Abuela" } })
  assert.equal(created.status, 201)
  assert.equal(created.body.weakPassword, true)
  assert.equal((await call("/api/admin/users", { token: admin, method: "POST", body: { name: "abuela", password: "otra" } })).status, 409)

  // Deactivating logs the profile out and hides it from sharing suggestions.
  const carlos = (await login("Carlos")).token
  assert.equal((await call(`/api/admin/users/${ids.Carlos}`, { token: admin, method: "PATCH", body: { active: false } })).body.active, false)
  assert.equal((await call("/api/auth/me", { token: carlos })).status, 401)
  assert.equal((await call("/api/auth/login", { method: "POST", body: { username: "Carlos", password: "Carlos" } })).status, 401)
  assert.ok(!(await call("/api/auth/profiles", { token: user })).body.some((p) => p.name === "Carlos"))

  // Password reset by the admin.
  await call(`/api/admin/users/${ids.Dana}`, { token: admin, method: "PATCH", body: { password: "secreta-larga" } })
  assert.equal((await login("Dana", "secreta-larga")).user.weakPassword, false)
  // The last admin cannot be removed or demoted.
  assert.equal((await call(`/api/admin/users/${ids.Alex}`, { token: admin, method: "PATCH", body: { active: false } })).status, 409)
  assert.equal((await call(`/api/admin/users/${ids.Alex}`, { token: admin, method: "PATCH", body: { role: "user" } })).status, 409)
})

test("own password change requires the current one", async (t) => {
  const { call, login } = await setup(t)
  const { token } = await login("Carlos")
  assert.equal((await call("/api/auth/password", { token, method: "POST", body: { current: "mal", next: "nueva-clave" } })).status, 403)
  assert.equal((await call("/api/auth/password", { token, method: "POST", body: { current: "Carlos", next: "nueva-clave" } })).status, 200)
  assert.equal((await call("/api/auth/me", { token })).status, 200) // this device stays logged in
})

test("likes, history and settings are isolated per profile", async (t) => {
  const { call, login } = await setup(t)
  const a = (await login("Blanca")).token, b = (await login("Dana")).token
  await call("/api/me/likes", { token: a, method: "PUT", body: { source: "mock", kind: "track", item: track("t1") } })
  assert.equal((await call("/api/me/likes?source=mock", { token: a })).body.tracks[0].id, "t1")
  assert.equal((await call("/api/me/likes?source=mock", { token: b })).body.tracks.length, 0)
  assert.equal((await call("/api/me/likes?source=ytdlp", { token: a })).body.tracks.length, 0)
  await call("/api/me/likes", { token: a, method: "DELETE", body: { source: "mock", kind: "track", id: "t1" } })
  assert.equal((await call("/api/me/likes?source=mock", { token: a })).body.tracks.length, 0)

  await call("/api/me/history", { token: a, method: "POST", body: { source: "mock", track: track("t2"), playedAt: 1000, listened: 40 } })
  await call("/api/me/history", { token: a, method: "POST", body: { source: "mock", track: track("t2"), playedAt: 1000, listened: 60 } })
  const history = (await call("/api/me/history?source=mock", { token: a })).body
  assert.equal(history.length, 1)
  assert.equal(history[0].listened, 60)
  assert.equal((await call("/api/me/history?source=mock", { token: b })).body.length, 0)

  await call("/api/me/settings", { token: a, method: "PUT", body: { settings: { crossfade: 6 } } })
  assert.deepEqual((await call("/api/me/settings", { token: a })).body, { crossfade: 6 })
  assert.deepEqual((await call("/api/me/settings", { token: b })).body, {})
})

test("import of device data is idempotent", async (t) => {
  const { call, login } = await setup(t)
  const { token } = await login("Alex")
  const data = { source: "mock", likes: [{ kind: "album", item: { id: "al1", name: "Disco" } }], playlists: [{ name: "Viaje", tracks: [track("t1"), track("t2"), track("t1")] }], history: [{ track: track("t1"), playedAt: 5, listened: 30 }], settings: { gapless: true } }
  assert.deepEqual((await call("/api/me/import", { token, method: "POST", body: data })).body, { likes: 1, playlists: 1, history: 1, settings: true })
  const again = (await call("/api/me/import", { token, method: "POST", body: data })).body
  assert.equal(again.playlists, 0)
  const lists = (await call("/api/playlists?source=mock", { token })).body
  assert.equal(lists.length, 1)
  assert.equal(lists[0].songCount, 2)
  assert.equal((await call("/api/me/history?source=mock", { token })).body.length, 1)
})

test("shared playlists: owner, editor, viewer, collaborative, added-by", async (t) => {
  const { call, login, ids } = await setup(t)
  const owner = (await login("Alex")).token, editor = (await login("Blanca")).token, viewer = (await login("Carlos")).token, outsider = (await login("Dana")).token
  const list = (await call("/api/playlists", { token: owner, method: "POST", body: { source: "mock", name: "Familia", track: track("t1") } })).body
  const path = `/api/playlists/${list.id}`
  assert.equal(list.role, "owner")
  const invitees = await call("/api/auth/profiles", { token: owner })
  assert.equal(invitees.status, 200)
  const editorId = invitees.body.find((p) => p.name === "Blanca").id

  assert.equal((await call(path, { token: outsider })).status, 404)
  assert.equal((await call("/api/playlists?source=mock", { token: outsider })).body.length, 0)

  assert.equal((await call(`${path}/members`, { token: editor, method: "PUT", body: { userId: ids.Blanca, role: "editor" } })).status, 404)
  await call(`${path}/members`, { token: owner, method: "PUT", body: { userId: editorId, role: "editor" } })
  await call(`${path}/members`, { token: owner, method: "PUT", body: { userId: ids.Carlos, role: "viewer" } })

  const added = await call(`${path}/tracks`, { token: editor, method: "POST", body: { track: track("t2") } })
  assert.equal(added.body.added, true)
  assert.deepEqual(added.body.playlist.tracks.map((x) => x.addedBy), ["Alex", "Blanca"])
  assert.equal((await call(`${path}/tracks`, { token: editor, method: "POST", body: { track: track("t2") } })).body.added, false)

  const seen = (await call(path, { token: viewer })).body
  assert.equal(seen.role, "viewer")
  assert.equal(seen.editable, false)
  assert.equal((await call(`${path}/tracks`, { token: viewer, method: "POST", body: { track: track("t3") } })).status, 403)
  assert.equal((await call(`${path}/tracks/t1`, { token: viewer, method: "DELETE" })).status, 403)
  assert.equal((await call(path, { token: editor, method: "PATCH", body: { name: "Mía" } })).status, 403)
  assert.equal((await call(path, { token: editor, method: "DELETE" })).status, 403)

  const moved = (await call(`${path}/move`, { token: editor, method: "POST", body: { from: 1, to: 0 } })).body
  assert.deepEqual(moved.tracks.map((x) => x.id), ["t2", "t1"])
  assert.deepEqual((await call(`${path}/tracks/t2`, { token: editor, method: "DELETE" })).body.tracks.map((x) => x.id), ["t1"])

  // Collaborative: every profile can see and add.
  await call(path, { token: owner, method: "PATCH", body: { collaborative: true } })
  assert.equal((await call(`${path}/tracks`, { token: outsider, method: "POST", body: { track: track("t4") } })).body.playlist.tracks.at(-1).addedBy, "Dana")
  assert.equal((await call(`${path}/tracks`, { token: viewer, method: "POST", body: { track: track("t5") } })).status, 200)

  // Members can leave; owner deletes.
  await call(path, { token: owner, method: "PATCH", body: { collaborative: false } })
  await call(`${path}/members/me`, { token: viewer, method: "DELETE" })
  assert.equal((await call(path, { token: viewer })).status, 404)
  assert.equal((await call(path, { token: owner, method: "DELETE" })).status, 200)
  assert.equal((await call(path, { token: editor })).status, 404)
})

test("first start creates only an administrator; a generated password is shown once and existing installs are untouched", async () => {
  const lines = []
  const db = openDb(":memory:")
  const first = await createProfileApi({ db, log: (line) => lines.push(line) })
  const users = first.accounts.list()
  assert.equal(users.length, 1)
  assert.equal(users[0].username, "admin")
  assert.equal(users[0].role, "admin")
  assert.equal(lines.length, 1)
  const password = /contraseña inicial: (\S+) /.exec(lines[0])?.[1]
  assert.ok(password && password.length >= 16)
  assert.ok(!users[0].password_hash.includes(password))
  assert.ok((await first.accounts.login("admin", password, "test"))?.token)
  // A restart with users already present creates nothing and logs nothing.
  await createProfileApi({ db, log: (line) => lines.push(line), admin: { username: "otro", password: "otra-clave" } })
  assert.equal(first.accounts.list().length, 1)
  assert.equal(lines.length, 1)
})

test("first start uses DECIBEL_ADMIN_USER / DECIBEL_ADMIN_PASSWORD when given, without printing the password", async () => {
  const lines = []
  const api = await createProfileApi({ log: (line) => lines.push(line), admin: { username: "Marta", password: "una-clave-larga" } })
  assert.deepEqual(api.accounts.list().map((u) => [u.username, u.role]), [["Marta", "admin"]])
  assert.ok((await api.accounts.login("marta", "una-clave-larga", "test"))?.token)
  assert.ok(!lines.join("\n").includes("una-clave-larga"))
})
