import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import test from "node:test"
import { api } from "../src/lib/profile/api.ts"

test("the 10 second deadline also aborts a response whose headers arrive but JSON body hangs", async (t) => {
  const previous = globalThis.window
  const deadline = new AbortController()
  const limits = []
  t.mock.method(AbortSignal, "timeout", (ms) => { limits.push(ms); return deadline.signal })
  let headersSent = false
  const app = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.write('{"user":')
    headersSent = true
    setTimeout(() => deadline.abort(new DOMException("Deadline", "TimeoutError")), 20)
  })
  app.listen(0, "127.0.0.1"); await once(app, "listening")
  globalThis.window = { location: { origin: "http://tauri.localhost" }, localStorage: { getItem: (key) => key === "decibel-server-url" ? `http://127.0.0.1:${app.address().port}` : null } }
  t.after(async () => { globalThis.window = previous; await new Promise((done) => { app.close(done); app.closeAllConnections() }) })
  await assert.rejects(api("/api/auth/me"), { status: 0, message: "No se puede conectar con el servidor." })
  assert.ok(headersSent)
  assert.deepEqual(limits, [10_000])
})

test("caller cancellation is preserved instead of being reported as a connection failure", async (t) => {
  const controller = new AbortController()
  t.mock.method(globalThis, "fetch", async (_url, { signal }) => new Promise((_done, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true })
  }))
  const pending = api("/api/auth/me", { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, { name: "AbortError" })
})
