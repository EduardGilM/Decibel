import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { resolveObjectURL } from "node:buffer"
import { PlaybackBuffer, BUFFER_TRACK_BYTES } from "../src/lib/audio/playback-buffer.ts"

const buffer = new PlaybackBuffer()
const scope = "disposable-profile"
const track = (id) => ({ id })
const provider = (owner = scope) => ({ kind: "ytdlp", offlineScope: owner, downloadRequest: async (t) => ({ url: `https://music.test/audio/${t.id}`, headers: { Authorization: "Bearer disposable" } }) })
const audio = (value = "complete audio", headers = {}) => new Response(value, { headers: { "Content-Type": "audio/mp4", ...headers } })
afterEach(() => buffer.clear())

test("current and next songs survive network loss; advancing keeps the prepared next and frees the old audio", async (t) => {
  const calls = []
  t.mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init }); return audio() })
  buffer.retain(scope, ["a", "b", "c"])
  await Promise.all([buffer.prepare(track("a"), provider()), buffer.prepare(track("a"), provider())])
  await buffer.prepare(track("b"), provider())
  await buffer.prepare(track("c"), provider())
  assert.equal(calls.length, 2)
  assert.ok(calls.every(({ init }) => init.headers.Authorization === "Bearer disposable" && init.credentials === "include"))
  const first = buffer.url(scope, "a"), next = buffer.url(scope, "b")
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Offline") })
  assert.equal(await resolveObjectURL(first).text(), "complete audio")
  buffer.retain(scope, ["b", "c"])
  assert.equal(resolveObjectURL(first), undefined)
  assert.equal(buffer.url(scope, "b"), next)
  assert.equal(await resolveObjectURL(next).text(), "complete audio")
  assert.equal(buffer.url(scope, "c"), undefined)
})

test("profile changes revoke old audio and late responses cannot populate another profile", async (t) => {
  let finish
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => { finish = resolve }))
  buffer.retain(scope, ["a"])
  const pending = buffer.prepare(track("a"), provider())
  await new Promise((resolve) => setImmediate(resolve))
  buffer.retain("other-profile", ["a"])
  finish(audio())
  await pending
  assert.equal(buffer.url(scope, "a"), undefined)
  assert.equal(buffer.url("other-profile", "a"), undefined)
  t.mock.method(globalThis, "fetch", async () => audio())
  await buffer.prepare(track("a"), provider("other-profile"))
  const url = buffer.url("other-profile", "a")
  assert.ok(url)
  buffer.retain(scope, ["a"])
  assert.equal(resolveObjectURL(url), undefined)
})

test("incomplete, oversized and non-audio files never become a reserve; failed jobs can retry", async (t) => {
  buffer.retain(scope, ["a"])
  for (const response of [audio("short", { "Content-Length": "999" }), audio("large", { "Content-Length": String(BUFFER_TRACK_BYTES + 1) }), new Response("error"), new Response("part", { status: 206, headers: { "Content-Type": "audio/mp4" } })]) {
    t.mock.method(globalThis, "fetch", async () => response)
    await buffer.prepare(track("a"), provider())
    assert.equal(buffer.url(scope, "a"), undefined)
  }
  t.mock.method(globalThis, "fetch", async () => audio())
  await buffer.prepare(track("a"), provider())
  assert.ok(buffer.url(scope, "a"))
})

test("losing connection cancels background work without throwing away ready audio", async (t) => {
  buffer.retain(scope, ["a", "b"])
  t.mock.method(globalThis, "fetch", async () => audio())
  await buffer.prepare(track("a"), provider())
  const saved = buffer.url(scope, "a")
  let signal
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    signal = init.signal
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
  })
  const pending = buffer.prepare(track("b"), provider())
  await new Promise((resolve) => setImmediate(resolve))
  buffer.pause()
  await pending
  assert.equal(signal.aborted, true)
  assert.equal(buffer.url(scope, "a"), saved)
  assert.equal(buffer.url(scope, "b"), undefined)
})
