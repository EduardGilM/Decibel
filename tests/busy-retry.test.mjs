import assert from "node:assert/strict"
import test from "node:test"
import { RETRY_DELAYS, YtDlpProvider } from "../src/lib/providers/ytdlp.ts"

const busy = () => Response.json({ error: "Hay varias consultas de música en curso. Espera unos segundos." }, { status: 429 })
const result = { tracks: [{ id: "yt:aaaaaaaaaaa", title: "Faro de papel", duration: 1 }], albums: [], artists: [] }
RETRY_DELAYS.fill(1) // keep the backoff steps, not their seconds

test("a busy server (429) is retried with backoff: the full search shows results, not the error", async (t) => {
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => (++calls < 3 ? busy() : Response.json(result)))
  assert.deepEqual(await new YtDlpProvider("http://music.test").search("faro de papel"), result)
  assert.equal(calls, 3)
})

test("the error is the last resort: shown only after every retry", async (t) => {
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => { calls++; return busy() })
  await assert.rejects(new YtDlpProvider("http://music.test").search("x"), { status: 429, message: /varias consultas/ })
  assert.equal(calls, RETRY_DELAYS.length + 1)
})

test("writes are never repeated, other errors are not retried and an abort stops the retries", async (t) => {
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => { calls++; return busy() })
  await assert.rejects(new YtDlpProvider("http://music.test").prepareTrack({ id: "yt:aaaaaaaaaaa", title: "a", duration: 1 }), { status: 429 })
  assert.equal(calls, 1)
  calls = 0
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ error: "Tipo de búsqueda no válido." }, { status: 400 }) })
  await assert.rejects(new YtDlpProvider("http://music.test").search("x"), { status: 400 })
  assert.equal(calls, 1)
  calls = 0
  const controller = new AbortController()
  t.mock.method(globalThis, "fetch", async () => { calls++; controller.abort(new Error("new keystroke")); return busy() })
  await assert.rejects(new YtDlpProvider("http://music.test").search("x", controller.signal, "tracks"), /new keystroke/)
  assert.equal(calls, 1)
})

test("a temporary catalogue failure (503, or Cloudflare's 502 page) is retried twice, then shown", async (t) => {
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => (++calls === 1 ? Response.json({ error: "No se pudo consultar YouTube Music. Vuelve a intentarlo." }, { status: 503 }) : calls === 2 ? new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }) : Response.json(result)))
  assert.deepEqual(await new YtDlpProvider("http://music.test").search("faro de papel"), result)
  assert.equal(calls, 3)
  calls = 0
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("<html>Bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }) })
  await assert.rejects(new YtDlpProvider("http://music.test").search("x"), { status: 502, message: /no responde/ })
  assert.equal(calls, 3)
})

test("resolving a song's audio retries a temporary failure and a dropped connection, then says so plainly", async (t) => {
  globalThis.window ??= new EventTarget() // streamUrl announces the library change
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => {
    calls++
    if (calls === 1) throw new TypeError("Failed to fetch")
    if (calls === 2) return Response.json({ error: "YouTube ha tardado demasiado. Vuelve a intentarlo." }, { status: 503 })
    return Response.json({ url: "https://audio.test/a", track: { id: "yt:aaaaaaaaaaa" } })
  })
  assert.equal(await new YtDlpProvider("http://music.test").streamUrl({ id: "yt:aaaaaaaaaaa", title: "a", duration: 1 }), "https://audio.test/a")
  assert.equal(calls, 3)
  calls = 0
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new TypeError("Failed to fetch") })
  await assert.rejects(new YtDlpProvider("http://music.test").streamUrl({ id: "yt:aaaaaaaaaaa", title: "a", duration: 1 }), { message: /No hay conexión con el servidor de música/ })
  assert.equal(calls, 2)
})
