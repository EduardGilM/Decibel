import assert from "node:assert/strict"
import { once } from "node:events"
import test from "node:test"
import { ARTWORK_MAX_AGE, createArtworkService } from "./artwork.mjs"
import { createApp } from "./index.mjs"

const url = "https://yt3.googleusercontent.com/test-cover=w120-h120-l90-rj"
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=", "base64")
const image = () => new Response(png, { headers: { "Content-Type": "image/png" } })

test("simultaneous covers share one request, stay cached and refresh after six hours", async () => {
  let calls = 0, now = 0, resolve
  const artwork = createArtworkService({ now: () => now, fetch: async (source, options) => {
    calls++
    assert.equal(source, url)
    assert.equal(options.redirect, "error")
    assert.ok(options.signal instanceof AbortSignal)
    if (calls === 1) await new Promise((done) => { resolve = done })
    return image()
  } })
  const first = artwork.get(url), second = artwork.get(url)
  assert.equal(calls, 1)
  resolve()
  const [a, b] = await Promise.all([first, second])
  assert.deepEqual(a.body, png)
  assert.equal(a, b)
  assert.equal(await artwork.get(url), a)
  assert.equal(calls, 1)
  now += ARTWORK_MAX_AGE * 1000
  await artwork.get(url)
  assert.equal(calls, 2)
})

test("untrusted URLs cannot trigger any upstream request", async () => {
  const artwork = createArtworkService({ fetch: () => assert.fail("Unexpected network request") })
  for (const source of [null, "", "not a URL", "http://i.ytimg.com/test", "https://localhost/private", "https://127.0.0.1/", "https://i.ytimg.com.evil.test/test", "https://evil.test/?url=https://i.ytimg.com/test", "https://user:pass@i.ytimg.com/test", "https://i.ytimg.com:8080/test", "https://i.ytimg.com/test#fragment", "file:///etc/passwd"]) {
    await assert.rejects(artwork.get(source), { status: 400 })
  }
})

test("redirects, HTML, SVG, empty and oversized images are rejected rather than cached", async () => {
  for (const response of [
    () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } }),
    () => new Response("blocked", { headers: { "Content-Type": "text/html" } }),
    () => new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }),
    () => new Response(null, { headers: { "Content-Type": "image/png" } }),
    () => new Response(png, { headers: { "Content-Type": "image/png", "Content-Length": 6 * 1024 * 1024 } }),
    () => new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { "Content-Type": "image/png" } }),
  ]) {
    let calls = 0
    const artwork = createArtworkService({ fetch: async () => ++calls === 1 ? response() : image() })
    await assert.rejects(artwork.get(url), { status: 502 })
    assert.deepEqual((await artwork.get(url)).body, png)
    assert.equal(calls, 2)
  }
})

test("temporary network and CDN failures are retried once, and failures can recover later", async () => {
  for (const failure of [() => { throw new TypeError("network error") }, () => new Response(null, { status: 429 }), () => new Response(null, { status: 503 })]) {
    let calls = 0
    const artwork = createArtworkService({ fetch: async () => ++calls === 1 ? failure() : image() })
    assert.deepEqual((await artwork.get(url)).body, png)
    assert.equal(calls, 2)
  }
  let unavailable = true, calls = 0
  const artwork = createArtworkService({ fetch: async () => { calls++; if (unavailable) throw new TypeError("offline"); return image() } })
  await assert.rejects(artwork.get(url), { status: 502 })
  assert.equal(calls, 2)
  unavailable = false
  assert.deepEqual((await artwork.get(url)).body, png)
})

test("the artwork cache evicts older entries after 200 covers", async () => {
  let calls = 0
  const artwork = createArtworkService({ fetch: async () => { calls++; return image() } })
  for (let i = 0; i < 200; i++) await artwork.get(`${url}?cover=${i}`)
  await artwork.get(`${url}?cover=0`)
  await artwork.get(`${url}?cover=200`)
  assert.equal(calls, 201)
  await artwork.get(`${url}?cover=0`)
  assert.equal(calls, 201)
  await artwork.get(`${url}?cover=1`)
  assert.equal(calls, 202)
})

test("the HTTP endpoint serves cacheable images and preserves API origin restrictions", async (t) => {
  let calls = 0
  const artwork = createArtworkService({ fetch: async () => { calls++; return image() } })
  const server = await createApp({ music: {}, artwork, allowedOrigins: ["http://127.0.0.1:3001"] })
  t.after(() => { server.closeAllConnections(); server.close() })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const base = `http://127.0.0.1:${server.address().port}/api/music/artwork`
  const response = await fetch(`${base}?url=${encodeURIComponent(url)}`, { headers: { Origin: "http://127.0.0.1:3001" } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Content-Type"), "image/png")
  assert.equal(response.headers.get("Cache-Control"), `public, max-age=${ARTWORK_MAX_AGE}`)
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff")
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:3001")
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png)
  assert.equal((await fetch(`${base}?url=${encodeURIComponent(url)}`, { headers: { Origin: "https://evil.test" } })).status, 403)
  assert.equal((await fetch(`${base}?url=${encodeURIComponent("https://localhost/private")}`)).status, 400)
  assert.equal(calls, 1)
})
