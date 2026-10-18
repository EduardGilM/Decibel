import assert from "node:assert/strict"
import { test } from "node:test"
import { androidUpdate, parseNativeStatus, versionCode } from "../src/lib/app-update.ts"

const sha = "b".repeat(64)
const info = (extra = {}) => ({ version: "0.1.9", versionCode: 1009, files: { android: { name: "Decibel-0.1.9.apk", sha256: sha, size: 10 } }, ...extra })

test("versionCode follows Tauri's Android rule", () => {
  assert.equal(versionCode("0.1.8"), 1008)
  assert.equal(versionCode("0.1.9"), 1009)
  assert.equal(versionCode("1.2.3"), 1002003)
  assert.equal(versionCode("x"), 0)
})

test("an APK is offered only if newer, well-formed and from an https server", () => {
  assert.deepEqual(androidUpdate(info(), "0.1.8", "https://music.example.com"), { version: "0.1.9", url: `https://music.example.com/releases/Decibel-0.1.9.apk?v=${sha.slice(0, 12)}`, sha256: sha, size: 10 })
  assert.equal(androidUpdate(info(), "0.1.9", "https://music.example.com"), null, "same version")
  assert.equal(androidUpdate(info(), "0.2.0", "https://music.example.com"), null, "older on the server")
  assert.equal(androidUpdate(info(), "0.1.8", "http://music.example.com"), null, "plain http")
  assert.equal(androidUpdate(info({ files: { android: { name: "../x.apk", sha256: sha, size: 1 } } }), "0.1.8", "https://m.example"), null)
  assert.equal(androidUpdate(info({ files: { android: { name: "D.apk", sha256: "nope", size: 1 } } }), "0.1.8", "https://m.example"), null)
  assert.equal(androidUpdate(info({ files: {} }), "0.1.8", "https://m.example"), null)
  assert.equal(androidUpdate(null, "0.1.8", "https://m.example"), null)
})

test("native download status", () => {
  assert.deepEqual(parseNativeStatus("downloading:42"), { state: "downloading", progress: 42 })
  assert.deepEqual(parseNativeStatus("error:sha256: no coincide"), { state: "error", message: "sha256: no coincide" })
  assert.deepEqual(parseNativeStatus("installing"), { state: "installing" })
  assert.deepEqual(parseNativeStatus(undefined), { state: "idle" })
})

test("«Más tarde» silences that version only for the rest of the day", async () => {
  const { snoozed, dayKey } = await import("../src/lib/app-update.ts")
  const today = dayKey(new Date(2026, 9, 18, 23, 59))
  assert.equal(today, "2026-10-18")
  const raw = JSON.stringify({ version: "0.1.10", day: today })
  assert.equal(snoozed(raw, "0.1.10", today), true)
  assert.equal(snoozed(raw, "0.1.10", dayKey(new Date(2026, 9, 19, 0, 1))), false, "asks again the next day")
  assert.equal(snoozed(raw, "0.1.11", today), false, "a newer version asks again")
  assert.equal(snoozed(null, "0.1.10", today), false)
  assert.equal(snoozed("{bad", "0.1.10", today), false)
})
