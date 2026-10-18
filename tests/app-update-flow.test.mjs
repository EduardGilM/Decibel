import assert from "node:assert/strict"
import { test } from "node:test"
import { androidProgress, installDesktopUpdate } from "../src/lib/app-update.ts"

// Mock of the Tauri updater's Update (no real download or install).
const mockUpdate = (events, fail) => ({
  version: "0.1.11",
  async downloadAndInstall(onEvent) { for (const e of events) onEvent?.(e); if (fail) throw new Error(fail) },
})

test("desktop «Actualizar»: progress, install and relaunch", async () => {
  const seen = []
  let relaunched = false
  await installDesktopUpdate(mockUpdate([
    { event: "Started", data: { contentLength: 200 } },
    { event: "Progress", data: { chunkLength: 50 } },
    { event: "Progress", data: { chunkLength: 150 } },
    { event: "Finished" },
  ]), async () => { relaunched = true }, (p) => seen.push(p))
  assert.deepEqual(seen.map((p) => [p.phase, p.progress]), [["downloading", null], ["downloading", 0.25], ["downloading", 1], ["installing", 1], ["installing", 1]])
  assert.equal(relaunched, true)
})

test("desktop: unknown size keeps an indeterminate bar; a failed download (e.g. bad signature) never relaunches", async () => {
  const seen = []
  let relaunched = false
  await assert.rejects(installDesktopUpdate(mockUpdate([{ event: "Started", data: {} }, { event: "Progress", data: { chunkLength: 10 } }], "signature verification failed"),
    async () => { relaunched = true }, (p) => seen.push(p)), /signature/)
  assert.deepEqual(seen, [{ phase: "downloading", progress: null }])
  assert.equal(relaunched, false)
})

test("android «Actualizar»: shell states map to the modal", () => {
  assert.deepEqual(androidProgress("idle"), null)
  assert.deepEqual(androidProgress("downloading:40"), { phase: "downloading", progress: 0.4 })
  assert.deepEqual(androidProgress("verifying"), { phase: "downloading", progress: 1 })
  assert.deepEqual(androidProgress("permission"), { phase: "permission", progress: 1 })
  assert.deepEqual(androidProgress("installing"), { phase: "installing", progress: 1 })
  assert.deepEqual(androidProgress("error:HTTP 404"), { phase: "error", progress: null, message: "HTTP 404" })
})
