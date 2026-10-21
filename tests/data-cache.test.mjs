import assert from "node:assert/strict"
import { test } from "node:test"
import { canUseStaleData, DataCache, dataKey } from "../src/lib/data-cache.ts"

test("suggestions and results share fresh and pending searches, separated by profile and filter", async () => {
  const cache = new DataCache()
  const a = dataKey("server#ana", "search:tracks:prueba")
  const b = dataKey("server#luis", "search:tracks:prueba")
  let requests = 0, resolve
  const fetcher = () => { requests++; return new Promise((done) => { resolve = done }) }
  const first = cache.load(a, fetcher, 1000)
  const preview = cache.load(a, fetcher, 1000)
  assert.equal(first, preview)
  await Promise.resolve()
  resolve({ tracks: ["a"] })
  assert.deepEqual(await first, { tracks: ["a"] })
  assert.deepEqual(await cache.load(a, fetcher, 1000), { tracks: ["a"] })
  assert.equal(requests, 1)
  assert.equal(cache.peek(b), undefined)
  assert.equal(cache.peek(dataKey("server#ana", "search:albums:prueba")), undefined)
  await cache.load(b, async () => "b", 1000)
  assert.equal(cache.peek(a).tracks[0], "a")
})

test("search entries expire and the least recently used entry is evicted", async () => {
  let now = 0
  const cache = new DataCache(2, () => now)
  await cache.load("a", async () => 1, 100)
  now = 99
  assert.equal(await cache.load("a", async () => 2, 100), 1)
  now = 100
  assert.equal(await cache.load("a", async () => 2, 100), 2)
  await cache.load("b", async () => 3, 100)
  await cache.load("a", async () => 9, 100)
  await cache.load("c", async () => 4, 100)
  assert.equal(cache.peek("a"), 2)
  assert.equal(cache.peek("b"), undefined)
})

test("failures are retriable and a request finishing after invalidation cannot refill the cache", async () => {
  const cache = new DataCache()
  await assert.rejects(cache.load("a", async () => { throw new Error("offline") }), /offline/)
  assert.equal(await cache.load("a", async () => 1), 1)
  let resolve
  const old = cache.load("a", () => new Promise((done) => { resolve = done }))
  await Promise.resolve()
  cache.clear()
  const fresh = cache.load("a", async () => 3)
  resolve(2)
  await Promise.all([old, fresh])
  assert.equal(cache.peek("a"), 3)
  cache.clear()
  assert.equal(cache.peek("a"), undefined)
})

test("refreshing retains the last good data through an outage without reviving an obsolete request", async () => {
  const cache = new DataCache()
  const key = dataKey("server#profile-a", "home")
  await cache.load(key, async () => ["cached album"], 1000)
  let finish
  const old = cache.load(key, () => new Promise((resolve) => { finish = resolve }))
  await Promise.resolve()
  cache.invalidate()
  assert.deepEqual(cache.peek(key), ["cached album"])
  await assert.rejects(cache.load(key, async () => { throw new TypeError("offline") }, 1000))
  finish(["obsolete"])
  await old
  assert.deepEqual(cache.peek(key), ["cached album"])
  assert.equal(cache.peek(dataKey("server#profile-b", "home")), undefined)
  assert.deepEqual(await cache.load(key, async () => ["updated album"], 1000), ["updated album"])
  cache.clear()
  assert.equal(cache.peek(key), undefined)
})

test("cached content never overrides a server's authentication, permission or deletion response", async () => {
  const cache = new DataCache()
  for (const status of [400, 401, 403, 404, 410]) {
    await cache.load("profile-a", async () => ["private content"])
    const error = Object.assign(new Error("Rejected"), { status })
    assert.equal(canUseStaleData(error), false)
    await assert.rejects(cache.load("profile-a", async () => { throw error }))
    assert.equal(cache.peek("profile-a"), undefined)
  }
  for (const status of [undefined, 0, 429, 500, 502, 503, 504]) {
    assert.equal(canUseStaleData(Object.assign(new Error("Unavailable"), { status })), true)
  }
})
