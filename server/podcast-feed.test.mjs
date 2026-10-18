import assert from "node:assert/strict"
import test from "node:test"
import { parsePodcastFeed } from "./podcast-feed.mjs"
import { rss } from "../tests/fixtures/podcasts.mjs"

test("RSS parses full episodes, duration, GUID and plain descriptions while excluding video", async () => {
  const data = await parsePodcastFeed(Buffer.from(rss))
  assert.equal(data.title, "Conversaciones")
  assert.equal(data.author, "Autora")
  assert.equal(data.description, "Un podcast de prueba")
  assert.equal(data.episodes.length, 2)
  assert.equal(data.episodes[0].guid, "stable-guid")
  assert.equal(data.episodes[0].duration, 3723)
  assert.equal(data.episodes[0].description, "Física & astronomía")
})

test("Atom enclosures and unknown duration are supported", async () => {
  const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><author><name>A</name></author><entry><id>atom-one</id><title>Episodio</title><link rel="enclosure" type="audio/ogg" href="https://media.example/one.ogg"/><published>2026-01-01T00:00:00Z</published></entry></feed>`
  const data = await parsePodcastFeed(Buffer.from(feed))
  assert.equal(data.episodes[0].author, "A")
  assert.equal(data.episodes[0].duration, 0)
})

test("HTML, malformed XML, DTDs and entities (including UTF-16) are rejected", async () => {
  for (const feed of ["<html><body>Not RSS</body></html>", "<rss>", '<!DOCTYPE rss [<!ENTITY secret SYSTEM "file:///etc/passwd">]><rss><channel><title>&secret;</title></channel></rss>']) {
    await assert.rejects(parsePodcastFeed(Buffer.from(feed)), { status: 502 })
  }
  const utf16 = '<?xml version="1.0" encoding="UTF-16"?><!DOCTYPE rss [<!ENTITY x "expanded">]><rss><channel><title>&x;</title></channel></rss>'
  await assert.rejects(parsePodcastFeed(Buffer.from("\ufeff" + utf16, "utf16le")), { status: 502 })
})
