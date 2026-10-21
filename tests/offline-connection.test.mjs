import assert from "node:assert/strict"
import { beforeEach, afterEach, after, test } from "node:test"
import { setImmediate as settle } from "node:timers/promises"
import { checkConnection, isOffline, monitorConnection, OFFLINE_GRACE_MS, useConnection } from "../src/lib/offline/connection.ts"

const previousWindow = globalThis.window, previousDocument = globalThis.document
const previousOnline = Object.getOwnPropertyDescriptor(navigator, "onLine")
globalThis.window = undefined; globalThis.document = undefined
Object.defineProperty(navigator, "onLine", { configurable: true, writable: true, value: true })
after(() => {
  if (previousWindow === undefined) delete globalThis.window
  else globalThis.window = previousWindow
  if (previousDocument === undefined) delete globalThis.document
  else globalThis.document = previousDocument
  if (previousOnline) Object.defineProperty(navigator, "onLine", previousOnline)
  else delete navigator.onLine
})
let stop
beforeEach((t) => {
  const win = new EventTarget()
  win.location = { origin: "http://tauri.localhost" }; win.localStorage = { getItem: () => null }
  t.mock.property(globalThis, "window", win)
  const doc = new EventTarget(); doc.visibilityState = "visible"
  t.mock.property(globalThis, "document", doc)
  t.mock.property(globalThis.navigator, "onLine", true)
  useConnection.setState({ offline: false, showDownloads: false })
})
afterEach(() => { stop?.(); stop = undefined })

test("a reachable server's auth errors stay online; a failed server switches to local music", async (t) => {
  let reply = new Response(null, { status: 401 })
  t.mock.method(globalThis, "fetch", async () => reply)
  stop = monitorConnection("https://music.test")
  await settle()
  assert.equal(isOffline(), false)
  reply = new Response(null, { status: 503 })
  window.dispatchEvent(new Event("online")); await settle()
  assert.equal(isOffline(), true)
  reply = new Response(null, { status: 200 })
  window.dispatchEvent(new Event("online")); await settle()
  assert.equal(isOffline(), false)
})

test("a browser offline event takes effect immediately and an old response cannot undo it", async (t) => {
  let done
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => { done = resolve }))
  stop = monitorConnection("https://music.test")
  window.dispatchEvent(new Event("offline"))
  assert.equal(isOffline(), true)
  done(new Response(null, { status: 200 })); await settle()
  assert.equal(isOffline(), true)
})

test("an audio failure can detect server loss immediately and later probe a restored connection", async (t) => {
  let up = true
  t.mock.method(globalThis, "fetch", async () => {
    if (!up) throw new TypeError("Connection reset")
    return new Response(null, { status: 200 })
  })
  stop = monitorConnection("https://music.test")
  await settle()
  up = false
  await checkConnection()
  assert.equal(isOffline(), true)
  up = true
  await checkConnection()
  assert.equal(isOffline(), false)
})

test("an unreachable server is retried in the background without an OS online event", async (t) => {
  let tick, up = false
  t.mock.method(globalThis, "setInterval", (callback) => { tick = callback; return 0 })
  t.mock.property(document, "visibilityState", "hidden")
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: up ? 200 : 503 }))
  stop = monitorConnection("https://music.test")
  await settle()
  assert.equal(isOffline(), true)
  up = true
  tick()
  await settle()
  assert.equal(isOffline(), false)
})

test("network errors enable local playback and disposed monitors cannot update connection state", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch") })
  stop = monitorConnection("https://music.test"); await settle()
  assert.equal(isOffline(), true)
  let done
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => { done = resolve }))
  window.dispatchEvent(new Event("online")); stop()
  done(new Response(null, { status: 200 })); await settle()
  assert.equal(isOffline(), true)
})

test("the visible app survives 119999 ms offline and switches only after two continuous minutes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] })
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }))
  stop = monitorConnection("https://music.test")
  await settle()
  assert.equal(isOffline(), true)
  assert.equal(useConnection.getState().showDownloads, false)
  t.mock.timers.tick(OFFLINE_GRACE_MS - 1)
  await settle()
  assert.equal(useConnection.getState().showDownloads, false)
  t.mock.timers.tick(1)
  assert.equal(useConnection.getState().showDownloads, true)
})

test("a successful server response resets the whole grace period, even if the outage repeats", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] })
  let status = 503
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status }))
  stop = monitorConnection("https://music.test")
  await settle()
  t.mock.timers.tick(90_000); await settle()
  status = 200
  await checkConnection()
  assert.equal(useConnection.getState().showDownloads, false)
  status = 503
  await checkConnection()
  t.mock.timers.tick(OFFLINE_GRACE_MS - 1); await settle()
  assert.equal(useConnection.getState().showDownloads, false)
  t.mock.timers.tick(1)
  assert.equal(useConnection.getState().showDownloads, true)
  status = 401
  await checkConnection()
  assert.equal(useConnection.getState().showDownloads, false)
})

test("heartbeat failures use the same delay and stopping the monitor cancels its fallback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] })
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 200 }))
  stop = monitorConnection("https://music.test")
  await settle()
  useConnection.setState({ offline: true })
  t.mock.timers.tick(19_999)
  assert.equal(useConnection.getState().showDownloads, false)
  stop(); stop = undefined
  t.mock.timers.tick(OFFLINE_GRACE_MS)
  assert.equal(useConnection.getState().showDownloads, false)
})
