import assert from "node:assert/strict"
import { test } from "node:test"
import { setImmediate as settle } from "node:timers/promises"
import { androidProgress, installDesktopUpdate } from "../src/lib/app-update.ts"
import { startUpdateChecks, useAppUpdate } from "../src/stores/app-update.ts"

// Mock of the Tauri updater's Update (no real download or install).
const mockUpdate = (events, fail) => ({
  version: "0.1.11",
  async downloadAndInstall(onEvent) { for (const e of events) onEvent?.(e); if (fail) throw new Error(fail) },
})

test("desktop «Actualizar»: progress, install and relaunch", async () => {
  const seen = []
  let relaunched = false
  await installDesktopUpdate(mockUpdate([
    { event: "Started", data: { contentLength: 200 } },
    { event: "Progress", data: { chunkLength: 50 } },
    { event: "Progress", data: { chunkLength: 150 } },
    { event: "Finished" },
  ]), async () => { relaunched = true }, (p) => seen.push(p))
  assert.deepEqual(seen.map((p) => [p.phase, p.progress]), [["downloading", null], ["downloading", 0.25], ["downloading", 1], ["installing", 1], ["installing", 1]])
  assert.equal(relaunched, true)
})

test("desktop: unknown size keeps an indeterminate bar; a failed download (e.g. bad signature) never relaunches", async () => {
  const seen = []
  let relaunched = false
  await assert.rejects(installDesktopUpdate(mockUpdate([{ event: "Started", data: {} }, { event: "Progress", data: { chunkLength: 10 } }], "signature verification failed"),
    async () => { relaunched = true }, (p) => seen.push(p)), /signature/)
  assert.deepEqual(seen, [{ phase: "downloading", progress: null }])
  assert.equal(relaunched, false)
})

test("android «Actualizar»: shell states map to the modal", () => {
  assert.deepEqual(androidProgress("idle"), null)
  assert.deepEqual(androidProgress("downloading:40"), { phase: "downloading", progress: 0.4 })
  assert.deepEqual(androidProgress("verifying"), { phase: "downloading", progress: 1 })
  assert.deepEqual(androidProgress("permission"), { phase: "permission", progress: 1 })
  assert.deepEqual(androidProgress("installing"), { phase: "installing", progress: 1 })
  assert.deepEqual(androidProgress("error:HTTP 404"), { phase: "error", progress: null, message: "HTTP 404" })
})

const release = (patch = 0) => ({
  version: `9.0.${patch}`, versionCode: 9_000_000 + patch,
  files: { android: { name: "Decibel.apk", sha256: "b".repeat(64), size: 100 } },
})

/** Disposable app, network and clock; never downloads or installs anything. */
function updateApp(t) {
  const window = Object.assign(new EventTarget(), { __TAURI_INTERNALS__: {}, DecibelNative: {} })
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" })
  const navigator = { onLine: true }
  const values = new Map()
  const localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const originals = new Map()
  for (const [key, value] of Object.entries({ window, document, navigator, localStorage })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  const base = process.env.NEXT_PUBLIC_UPDATE_URL
  process.env.NEXT_PUBLIC_UPDATE_URL = "https://updates.example.test"
  useAppUpdate.setState(useAppUpdate.getInitialState(), true)
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: Date.UTC(2026, 9, 19) })
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json(null))
  const stops = []
  t.after(() => {
    for (const stop of stops) stop()
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    if (base === undefined) delete process.env.NEXT_PUBLIC_UPDATE_URL
    else process.env.NEXT_PUBLIC_UPDATE_URL = base
    useAppUpdate.setState(useAppUpdate.getInitialState(), true)
  })
  return {
    window, document, navigator, fetch,
    start() { const stop = startUpdateChecks(); stops.push(stop); return stop },
    async advance(ms) { t.mock.timers.tick(ms); await settle() },
  }
}

test("an open app discovers new releases every 15 minutes and respects «Más tarde»", async (t) => {
  const app = updateApp(t)
  app.start()
  await app.advance(3999)
  assert.equal(app.fetch.mock.callCount(), 0, "startup does not compete with the first screen")
  await app.advance(1)
  assert.equal(app.fetch.mock.callCount(), 1)
  assert.equal(useAppUpdate.getState().offer, null)
  app.fetch.mock.mockImplementation(async () => Response.json(release()))
  await app.advance(15 * 60_000 - 4000)
  assert.equal(app.fetch.mock.callCount(), 2)
  assert.equal(useAppUpdate.getState().offer.version, "9.0.0")
  assert.equal(useAppUpdate.getState().open, true)
  assert.equal(useAppUpdate.getState().phase, "idle", "detection never starts an install")
  useAppUpdate.getState().later()
  await app.advance(15 * 60_000)
  assert.equal(useAppUpdate.getState().open, false, "same version stays snoozed")
  app.fetch.mock.mockImplementation(async () => Response.json(release(1)))
  await app.advance(15 * 60_000)
  assert.equal(useAppUpdate.getState().offer.version, "9.0.1")
  assert.equal(useAppUpdate.getState().open, true, "a newer release is offered without restarting")
})

test("hidden and offline apps wait; visibility and focus recheck with a one-minute cooldown", async (t) => {
  const app = updateApp(t)
  app.document.visibilityState = "hidden"
  app.start()
  await app.advance(30 * 60_000)
  assert.equal(app.fetch.mock.callCount(), 0)
  app.document.visibilityState = "visible"
  app.document.dispatchEvent(new Event("visibilitychange"))
  app.window.dispatchEvent(new Event("focus"))
  await settle()
  assert.equal(app.fetch.mock.callCount(), 1)
  await app.advance(60_000)
  app.window.dispatchEvent(new Event("focus"))
  await settle()
  assert.equal(app.fetch.mock.callCount(), 2)
  app.navigator.onLine = false
  await app.advance(15 * 60_000)
  app.window.dispatchEvent(new Event("focus"))
  assert.equal(app.fetch.mock.callCount(), 2)
  app.navigator.onLine = true
  app.window.dispatchEvent(new Event("online"))
  await settle()
  assert.equal(app.fetch.mock.callCount(), 3)
})

test("reconnecting immediately retries a failed check and HTTP errors keep the known offer", async (t) => {
  const app = updateApp(t)
  app.fetch.mock.mockImplementation(async () => Response.json(release()))
  await useAppUpdate.getState().check()
  const offer = useAppUpdate.getState().offer
  app.fetch.mock.mockImplementation(async () => Response.json({}, { status: 503 }))
  await useAppUpdate.getState().check()
  assert.equal(useAppUpdate.getState().offer, offer)
  assert.equal(useAppUpdate.getState().open, true)
  app.fetch.mock.mockImplementation(async () => Response.json(release(1)))
  app.start()
  app.window.dispatchEvent(new Event("online"))
  app.window.dispatchEvent(new Event("focus"))
  await settle()
  assert.equal(app.fetch.mock.callCount(), 3, "reconnect bypasses the cooldown without a duplicate focus check")
  assert.equal(useAppUpdate.getState().offer.version, "9.0.1")
})

test("overlapping requests are suppressed and late results cannot replace an update being installed", async (t) => {
  const app = updateApp(t)
  app.fetch.mock.mockImplementation(async () => Response.json(release()))
  await useAppUpdate.getState().check()
  const offer = useAppUpdate.getState().offer
  let finish
  app.fetch.mock.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const pending = useAppUpdate.getState().check()
  await useAppUpdate.getState().check()
  assert.equal(app.fetch.mock.callCount(), 2)
  useAppUpdate.setState({ phase: "downloading" })
  finish(Response.json(release(1)))
  await pending
  assert.equal(useAppUpdate.getState().offer, offer)
  for (const phase of ["downloading", "installing", "permission"]) {
    useAppUpdate.setState({ phase })
    await useAppUpdate.getState().check()
  }
  assert.equal(app.fetch.mock.callCount(), 2)
})

test("a timed-out request releases the guard so the next check can succeed", async (t) => {
  const app = updateApp(t)
  const controller = new AbortController()
  const timeout = t.mock.method(AbortSignal, "timeout", () => controller.signal)
  app.fetch.mock.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  }))
  const pending = useAppUpdate.getState().check()
  assert.equal(timeout.mock.calls[0].arguments[0], 15_000)
  controller.abort(new DOMException("Timed out", "TimeoutError"))
  await pending
  timeout.mock.restore()
  app.fetch.mock.mockImplementation(async () => Response.json(release()))
  await useAppUpdate.getState().check()
  assert.equal(useAppUpdate.getState().offer.version, "9.0.0")
})

test("returning from Android settings resumes the permission step without checking for another update", async (t) => {
  const app = updateApp(t)
  app.window.DecibelNative.canInstallPackages = () => true
  const resume = app.window.DecibelNative.resumeInstall = t.mock.fn()
  useAppUpdate.setState({ phase: "permission" })
  app.start()
  app.window.dispatchEvent(new Event("focus"))
  assert.equal(resume.mock.callCount(), 1)
  assert.equal(app.fetch.mock.callCount(), 0)
})

test("unmount removes the timers and listeners; browser sessions never check", async (t) => {
  const app = updateApp(t)
  const stop = app.start()
  stop()
  await app.advance(15 * 60_000)
  app.window.dispatchEvent(new Event("online"))
  app.window.dispatchEvent(new Event("focus"))
  app.document.dispatchEvent(new Event("visibilitychange"))
  assert.equal(app.fetch.mock.callCount(), 0)
  app.start()
  await app.advance(4000)
  assert.equal(app.fetch.mock.callCount(), 1, "a remount starts only one check")
  delete app.window.__TAURI_INTERNALS__
  app.start()
  await app.advance(15 * 60_000)
  app.window.dispatchEvent(new Event("online"))
  await useAppUpdate.getState().check()
  assert.equal(app.fetch.mock.callCount(), 1, "the web does not use native updates")
})

test("desktop checks have a timeout and release superseded native resources, including during install", async (t) => {
  const app = updateApp(t)
  delete app.window.DecibelNative
  let rid = 0
  const closed = []
  app.window.__TAURI_INTERNALS__.invoke = t.mock.fn(async (command, args) => {
    if (command === "plugin:resources|close") { closed.push(args.rid); return }
    assert.equal(command, "plugin:updater|check")
    assert.equal(args.timeout, 15_000)
    if (rid === 2) useAppUpdate.setState({ phase: "downloading" })
    return { rid: ++rid, version: "9.0.0", currentVersion: "0.1.0", rawJson: {} }
  })
  await useAppUpdate.getState().check()
  await useAppUpdate.getState().check()
  await settle()
  assert.deepEqual(closed, [1])
  const offer = useAppUpdate.getState().offer
  await useAppUpdate.getState().check()
  await settle()
  assert.equal(useAppUpdate.getState().offer, offer)
  assert.deepEqual(closed, [1, 3], "the resource being installed stays alive")
})
