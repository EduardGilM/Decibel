import assert from "node:assert/strict"
import { EventEmitter, once } from "node:events"
import { Readable } from "node:stream"
import test from "node:test"
import { createApp } from "./index.mjs"
import { createProfileApi } from "./profile-api.mjs"
import { createPodcastHttp } from "./podcast-http.mjs"
import { musicAudioUrl } from "./music-stream.mjs"

const audioUrl = "https://r1.googlevideo.com/videoplayback?temporary=secret"
const id = "yt:aaaaaaaaaaa"
async function fixture(t, request) {
  const profiles = await createProfileApi({ seed: false })
  await profiles.accounts.createUser({ username: "Offline Test", password: "disposable-offline-password" })
  const calls = []
  const music = { stream: async (id) => { calls.push(id); return { url: audioUrl } } }
  const app = await createApp({ music, profiles, allowedOrigins: ["http://tauri.localhost"], streamRequest: request })
  app.listen(0, "127.0.0.1"); await once(app, "listening")
  t.after(async () => { await new Promise((r) => { app.close(r); app.closeAllConnections() }); profiles.db.close() })
  const base = `http://127.0.0.1:${app.address().port}`
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "Offline Test", password: "disposable-offline-password" }) })
  const { token } = await login.json()
  return { base, calls, music, headers: { Authorization: `Bearer ${token}`, Origin: "http://tauri.localhost", "X-Decibel-Purpose": "download" } }
}
const bytes = (value = "audio bytes", status = 200, headers = {}) => ({ status, headers: { "content-type": "audio/webm", "content-length": String(Buffer.byteLength(value)), "accept-ranges": "bytes", ...headers }, body: Readable.from([value]) })

test("native downloads receive full bytes from the authenticated Decibel stream, with no session forwarded upstream", async (t) => {
  const upstream = []
  const f = await fixture(t, async (url, options) => { upstream.push({ url, ...options }); return bytes() })
  const path = `${f.base}/api/music/stream?id=${id}`
  assert.equal((await fetch(path)).status, 401)
  const response = await fetch(path, { headers: f.headers })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "audio/webm")
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("access-control-allow-origin"), "http://tauri.localhost")
  assert.equal(await response.text(), "audio bytes")
  assert.deepEqual(f.calls, ["aaaaaaaaaaa"])
  assert.deepEqual(upstream[0].headers, {})
  assert.equal(upstream[0].url, audioUrl)
  assert.equal((await fetch(path, { headers: { ...f.headers, Origin: "https://evil.test" } })).status, 403)
})

test("Range, HEAD, invalid IDs and upstream errors preserve the stream contract", async (t) => {
  const options = []
  let status = 206
  const f = await fixture(t, async (_url, init) => { options.push(init); return bytes("abc", status, { "content-range": "bytes 2-4/10" }) })
  const path = `${f.base}/api/music/stream?id=${id}`
  const ranged = await fetch(path, { headers: { ...f.headers, Range: "bytes=2-4" } })
  assert.equal(ranged.status, 206)
  assert.equal(ranged.headers.get("content-range"), "bytes 2-4/10")
  assert.equal(await ranged.text(), "abc")
  assert.deepEqual(options[0].headers, { Range: "bytes=2-4" })
  status = 200
  const head = await fetch(path, { method: "HEAD", headers: f.headers })
  assert.equal(head.status, 200); assert.equal(await head.text(), ""); assert.equal(options[1].method, "HEAD")
  assert.equal((await fetch(path, { headers: { ...f.headers, Range: "bytes=0-1,3-4" } })).status, 416)
  assert.equal((await fetch(`${f.base}/api/music/stream?id=../../file`, { headers: f.headers })).status, 400)
  status = 403
  assert.equal((await fetch(path, { headers: f.headers })).status, 502)
})

test("a disconnected downloader cancels its upstream request", async (t) => {
  let started
  const ready = new Promise((r) => { started = r })
  let signal
  const f = await fixture(t, async (_url, options) => {
    signal = options.signal; started()
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))
  })
  const abort = new AbortController()
  const pending = fetch(`${f.base}/api/music/stream?id=${id}`, { headers: f.headers, signal: abort.signal })
  await ready; abort.abort()
  await assert.rejects(pending)
  for (let i = 0; !signal.aborted && i < 20; i++) await new Promise((r) => setTimeout(r, 10))
  assert.equal(signal.aborted, true)
})

test("only resolved HTTPS audio CDN URLs, including redirect targets, reach the public-address transport", async () => {
  for (const url of ["http://r1.googlevideo.com/a", "https://googlevideo.com.evil.test/a", "https://localhost/a", "https://r1.googlevideo.com:444/a", "https://user:pass@r1.googlevideo.com/a", "file:///tmp/file"]) assert.throws(() => musicAudioUrl(url))
  const connections = []
  const request = createPodcastHttp({ validateUrl: (value, base) => musicAudioUrl(new URL(value, base).href), lookup: async () => [{ address: "8.8.8.8", family: 4 }], transports: { "https:": (url, _options, done) => {
    connections.push(url.href)
    const req = new EventEmitter(); req.setTimeout = () => {}
    req.end = () => queueMicrotask(() => {
      const response = Readable.from([]); response.statusCode = 302; response.headers = { location: "https://other.test/private" }; done(response)
    })
    return req
  } } })
  await assert.rejects(request(audioUrl))
  assert.deepEqual(connections, [audioUrl])
})

test("an expired audio URL is renewed once on the server before bytes are sent", async (t) => {
  const refreshes = []
  let requests = 0
  const f = await fixture(t, async () => bytes("renewed audio", ++requests === 1 ? 403 : 200))
  f.music.stream = async (_id, { refresh }) => { refreshes.push(refresh); return { url: audioUrl } }
  const response = await fetch(`${f.base}/api/music/stream?id=${id}`, { headers: f.headers })
  assert.equal(response.status, 200)
  assert.equal(await response.text(), "renewed audio")
  assert.deepEqual(refreshes, [false, true])
})
