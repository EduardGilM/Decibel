import assert from "node:assert/strict"
import { test } from "node:test"
import { canDownload, fits, formatBytes, usedBytes } from "../src/lib/offline/policy.ts"

test("YouTube is never downloadable, other sources are", () => {
  assert.equal(canDownload("ytdlp"), false)
  assert.equal(canDownload("ytdlp", { id: "abc" }), false)
  assert.equal(canDownload("subsonic", { id: "yt:abc" }), false)
  assert.equal(canDownload("subsonic", { id: "tr-1" }), true)
  assert.equal(canDownload("mock"), true)
  assert.equal(canDownload(null), false)
})

test("space limit", () => {
  const items = { a: { size: 600 * 1024 * 1024 }, b: { size: 400 * 1024 * 1024 } }
  assert.equal(usedBytes(items), 1000 * 1024 * 1024)
  assert.equal(fits(items, 24 * 1024 * 1024, 1024), true)
  assert.equal(fits(items, 25 * 1024 * 1024, 1024), false)
  assert.equal(formatBytes(2048 * 1024 * 1024), "2.0 GB")
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB")
})
