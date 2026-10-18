import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { gzipSync } from "node:zlib"
import test from "node:test"
import { createPodcastHttp, podcastUrl, publicAddress, readPodcastBody } from "./podcast-http.mjs"
import { remote } from "../tests/fixtures/podcasts.mjs"

test("podcast URLs reject private literals, credentials, alternate ports and non-HTTP schemes", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "100.64.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.2", "::1", "fe80::1", "fc00::1", "::ffff:8.8.8.8", "2002:a00:1::", "2001:db8::1"]) assert.equal(publicAddress(address), false, address)
  for (const url of ["http://127.1/x", "http://2130706433/", "http://[::1]/", "http://localhost/x", "http://user:pass@example.com/", "https://example.com:3000/", "file:///etc/passwd"]) assert.throws(() => podcastUrl(url), { status: 400 })
  assert.equal(publicAddress("8.8.8.8"), true)
  assert.equal(publicAddress("2606:4700:4700::1111"), true)
})

test("DNS results and redirects are checked and the validated address is pinned", async () => {
  const connections = [], lookups = []
  const transport = (url, options, done) => {
    connections.push(url.href)
    options.lookup(url.hostname, {}, (_error, address, family) => { assert.equal(address, "8.8.8.8"); assert.equal(family, 4) })
    assert.equal(options.headers.Authorization, undefined)
    const request = new EventEmitter()
    request.setTimeout = () => {}
    request.end = () => queueMicrotask(() => { const response = remote().body; response.statusCode = 302; response.headers = { location: "https://internal.example/secret" }; done(response) })
    return request
  }
  const request = createPodcastHttp({ lookup: async (host) => { lookups.push(host); return [{ address: host === "public.example" ? "8.8.8.8" : "10.0.0.1", family: 4 }] }, transports: { "https:": transport } })
  await assert.rejects(request("https://public.example/feed"), { status: 400 })
  assert.deepEqual(lookups, ["public.example", "internal.example"])
  assert.deepEqual(connections, ["https://public.example/feed"])
  const mixed = createPodcastHttp({ lookup: async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }], transports: { "https:": transport } })
  await assert.rejects(mixed("https://public.example/"), { status: 400 })
})

test("decompressed metadata is bounded and its streams close on failure", async () => {
  const compressed = remote(gzipSync(Buffer.alloc(1000)), { headers: { "content-encoding": "gzip" } })
  await assert.rejects(readPodcastBody(compressed, 100), { status: 502 })
  assert.equal(compressed.body.destroyed, true)
  assert.equal((await readPodcastBody(remote("valid"))).toString(), "valid")
})
