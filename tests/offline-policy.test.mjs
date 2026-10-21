import assert from "node:assert/strict"
import { test } from "node:test"
import { canDownload, downloadScope, fits, formatBytes, usedBytes } from "../src/lib/offline/policy.ts"

test("music from Decibel and Navidrome is downloadable; RSS episodes use their own playback path", () => {
  assert.equal(canDownload("ytdlp"), true)
  assert.equal(canDownload("ytdlp", { id: "yt:aaaaaaaaaaa" }), true)
  assert.equal(canDownload("subsonic", { id: "tr-1" }), true)
  assert.equal(canDownload("mock"), true)
  assert.equal(canDownload(null), false)
  assert.equal(canDownload("ytdlp", { id: "episode:a" }), false)
  assert.equal(canDownload("ytdlp", { id: "a", podcast: { episodeId: "a" } }), false)
})

test("downloads belong to a server, profile and source account", () => {
  const scope = downloadScope("ytdlp", "https://music.test/", "alice")
  assert.equal(scope, downloadScope("ytdlp", "https://music.test", "alice"))
  assert.notEqual(scope, downloadScope("ytdlp", "https://other.test", "alice"))
  assert.notEqual(scope, downloadScope("ytdlp", "https://music.test", "bob"))
  assert.notEqual(downloadScope("subsonic", "https://music.test", null, "alice"), downloadScope("subsonic", "https://music.test", null, "bob"))
})

test("space limit and readable sizes", () => {
  const items = { a: { size: 600 * 1024 * 1024 }, b: { size: 400 * 1024 * 1024 } }
  assert.equal(usedBytes(items), 1000 * 1024 * 1024)
  assert.equal(fits(items, 24 * 1024 * 1024, 1024), true)
  assert.equal(fits(items, 25 * 1024 * 1024, 1024), false)
  assert.equal(formatBytes(0), "0 KB")
  assert.equal(formatBytes(2048 * 1024 * 1024), "2.0 GB")
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB")
})
