import assert from "node:assert/strict"
import { after, beforeEach, test } from "node:test"

const values = new Map()
const originalWindow = globalThis.window, originalStorage = globalThis.localStorage
const configuredServer = process.env.NEXT_PUBLIC_DECIBEL_SERVER
globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
globalThis.window = { localStorage, location: { origin: "http://tauri.localhost" }, dispatchEvent: () => {} }
const { useProfile } = await import("../src/stores/profile.ts")
after(() => {
  globalThis.window = originalWindow; globalThis.localStorage = originalStorage
  if (configuredServer === undefined) delete process.env.NEXT_PUBLIC_DECIBEL_SERVER
  else process.env.NEXT_PUBLIC_DECIBEL_SERVER = configuredServer
})
beforeEach(() => {
  values.clear(); values.set("decibel-server-url", "https://music.test")
  delete process.env.NEXT_PUBLIC_DECIBEL_SERVER
  useProfile.setState({ user: null, status: "checking", weakProfiles: [] })
})
const user = { id: "profile-test", name: "Perfil", role: "user" }

test("a configured server failing on first launch never enables the anonymous legacy mode", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("offline") })
  await useProfile.getState().check()
  assert.equal(useProfile.getState().status, "error")
  assert.equal(useProfile.getState().user, null)
})

test("retry enters checking and asks for login after the connection recovers", async (t) => {
  useProfile.setState({ status: "error" })
  let reply
  t.mock.method(globalThis, "fetch", () => new Promise((done) => { reply = done }))
  const checking = useProfile.getState().check()
  assert.equal(useProfile.getState().status, "checking")
  reply(Response.json({ error: "Login required" }, { status: 401 }))
  await checking
  assert.equal(useProfile.getState().status, "anon")
  assert.equal(useProfile.getState().user, null)
})

test("an unavailable server keeps a previously authenticated profile for offline use", async (t) => {
  useProfile.setState({ user })
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("offline") })
  await useProfile.getState().check()
  assert.equal(useProfile.getState().status, "offline")
  assert.deepEqual(useProfile.getState().user, user)
})

test("404 on an explicitly configured backend does not bypass login", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 404 }))
  await useProfile.getState().check()
  assert.equal(useProfile.getState().status, "error")
})

test("a development server without profiles can still use its legacy mode", async (t) => {
  values.delete("decibel-server-url")
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 404 }))
  await useProfile.getState().check()
  assert.equal(useProfile.getState().status, "unavailable")
})

test("an older session check cannot clear a later successful login", async (t) => {
  let finish
  t.mock.method(globalThis, "fetch", async (url) => url.endsWith("/login") ? Response.json({ user, token: "fixture-session" }) : new Promise((done) => { finish = done }))
  const checking = useProfile.getState().check()
  await useProfile.getState().login("Perfil", "fixture-password")
  finish(Response.json({}, { status: 401 }))
  await checking
  assert.equal(useProfile.getState().status, "ready")
  assert.deepEqual(useProfile.getState().user, user)
})

test("revalidation keeps the active session usable until a real authentication failure", async (t) => {
  useProfile.setState({ user, status: "ready" })
  let finish
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => { finish = resolve }))
  const checking = useProfile.getState().check()
  assert.equal(useProfile.getState().status, "ready")
  finish(Response.json({}, { status: 401 }))
  await checking
  assert.equal(useProfile.getState().status, "anon")
  assert.equal(useProfile.getState().user, null)
})

test("a temporary same-origin 404 never drops the saved profile or changes its cache scope", async (t) => {
  values.delete("decibel-server-url")
  useProfile.setState({ user, status: "ready" })
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 404 }))
  await useProfile.getState().check()
  assert.equal(useProfile.getState().status, "offline")
  assert.deepEqual(useProfile.getState().user, user)
})
