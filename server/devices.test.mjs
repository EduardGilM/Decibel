import assert from "node:assert/strict"
import { test } from "node:test"
import { createDevices } from "./devices.mjs"
import { createApp } from "./index.mjs"

const song = { id: "yt:aaaaaaaaaaa", title: "Canción", artist: "Artista", album: "", duration: 120 }
const state = () => ({ queue: [song], original: [song], index: 0, isPlaying: true, position: 37, duration: 120, volume: 0.7, muted: false, shuffle: false, repeat: "off" })
const desktop = { id: "desktop-123", name: "Ordenador", kind: "computer" }
const phone = { id: "phone-12345", name: "Teléfono", kind: "phone" }
function setup() {
  let time = 1000
  const service = createDevices({ now: () => time })
  const call = (route, body, user = "profile-a") => service.perform(user, route, body)
  const beat = (device, extra = {}, user) => call("heartbeat", { ...device, ...extra }, user)
  return { call, beat, advance: (ms) => { time += ms } }
}

test("devices and commands are scoped to the authenticated profile", () => {
  const { call, beat } = setup()
  const a = beat(desktop, { state: state() })
  assert.equal(a.activeId, desktop.id)
  const b = beat(phone, { state: state() }, "profile-b")
  assert.deepEqual(b.devices.map((d) => d.id), [phone.id])
  assert.throws(() => call("transfer", { id: phone.id, target: desktop.id, epoch: b.epoch }, "profile-b"), { status: 404 })
  assert.throws(() => call("command", { id: phone.id, epoch: a.epoch, command: { action: "toggle", args: [] } }), { status: 409 })
})

test("transfer waits for the previous output to stop and preserves its final queue and position", () => {
  const { call, beat } = setup()
  const a = beat(desktop, { state: state() })
  beat(phone)
  const pending = call("transfer", { id: phone.id, target: phone.id, epoch: a.epoch })
  assert.equal(pending.activeId, null)
  assert.equal(pending.pendingId, phone.id)
  assert.equal(beat(phone).activeId, null)
  const stopped = beat(desktop, { epoch: pending.epoch, stopped: true, state: { ...state(), position: 39 } })
  assert.equal(stopped.activeId, phone.id)
  const resumed = beat(phone, { epoch: pending.epoch, state: { ...state(), position: 0 } })
  assert.equal(resumed.state.position, 39, "stale target state must not overwrite the handoff")
  assert.deepEqual(resumed.state.queue, [song])
  assert.equal(resumed.state.isPlaying, true)
  assert.throws(() => call("command", { id: desktop.id, epoch: a.epoch, command: { action: "toggle", args: [] } }), { status: 409 })
})

test("controls are delivered only to the output and retained until acknowledged", () => {
  const { call, beat } = setup()
  const a = beat(desktop, { state: state() })
  beat(phone)
  call("command", { id: phone.id, epoch: a.epoch, command: { action: "seek", args: [60] } })
  assert.equal(beat(phone).commands.length, 0)
  const controls = beat(desktop, { epoch: a.epoch }).commands
  assert.equal(controls.length, 1)
  assert.deepEqual(controls[0].args, [60])
  assert.deepEqual(beat(desktop, { epoch: a.epoch }).commands, controls)
  assert.equal(beat(desktop, { epoch: a.epoch, ack: controls[0].id, state: { ...state(), position: 60 } }).commands.length, 0)
  assert.equal(beat(phone).state.position, 60)
})

test("an unreachable output cannot overlap a transfer before its lease expires", () => {
  const { call, beat, advance } = setup()
  const a = beat(desktop, { state: state() })
  beat(phone)
  call("transfer", { id: phone.id, target: phone.id, epoch: a.epoch })
  advance(7999)
  assert.equal(beat(phone).activeId, null)
  advance(1)
  assert.equal(beat(phone).activeId, phone.id)
  advance(12001)
  assert.deepEqual(beat(phone).devices.map((d) => d.id), [phone.id])
})

test("invalid snapshots, controls and oversized registries are rejected", () => {
  const { beat, call } = setup()
  assert.throws(() => beat(desktop, { state: { ...state(), index: 4 } }), { status: 400 })
  const a = beat(desktop, { state: state() })
  for (const command of [{ action: "seek", args: [-1] }, { action: "setVolume", args: [2] }, { action: "configureRecommendations", args: [] }, { action: "next", args: [true] }]) {
    assert.throws(() => call("command", { id: desktop.id, epoch: a.epoch, command }), { status: 400 })
  }
  for (let i = 0; i < 31; i++) beat({ ...phone, id: `device-${String(i).padStart(3, "0")}` })
  assert.throws(() => beat(phone), { status: 429 })
})

test("device HTTP routes require authentication and reject malformed bodies", async (t) => {
  const { MusicError } = await import("./errors.mjs")
  const app = await createApp({
    music: {},
    podcasts: null,
    profiles: {
      handle: () => false,
      guard: (req) => {
        if (req.headers.authorization !== "Bearer disposable-token") throw new MusicError("Inicia sesión.", 401)
        return { id: "test-user" }
      },
    },
  })
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => { app.close(resolve); app.closeAllConnections() }))
  const url = `http://127.0.0.1:${app.address().port}/api/devices/heartbeat`
  assert.equal((await fetch(url, { method: "POST" })).status, 401)
  const headers = { Authorization: "Bearer disposable-token", "Content-Type": "application/json" }
  assert.equal((await fetch(url, { method: "POST", headers, body: "{" })).status, 400)
  const ok = await fetch(url, { method: "POST", headers, body: JSON.stringify({ ...desktop, state: state() }) })
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).activeId, desktop.id)
})
