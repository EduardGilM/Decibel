import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"
import { createYtDlpRunner } from "./ytdlp.mjs"

// Un trabajador Node hace de interprete: habla el mismo protocolo JSONL que ytdlp-worker.py.
const stubWorker = (body) => `${body}
let buffer = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  for (let newline; (newline = buffer.indexOf("\\n")) >= 0;) {
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (!line.trim()) continue
    let request
    try { request = JSON.parse(line) } catch { continue }
    handle(request, (payload) => process.stdout.write(JSON.stringify({ id: request.id, ...payload }) + "\\n"))
  }
})
`

test("el trabajador residente atiende version y canciones, y sobrevive entre peticiones", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "musica-runner-"))
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true })))
  const worker = resolve(dir, "stub-on.mjs")
  await writeFile(worker, stubWorker(`
let answers = 0
process.stdout.write(JSON.stringify({ event: "ready", version: "stub-1" }) + "\\n")
function handle(request, reply) {
  if (request.op === "version") return reply({ ok: true, version: "stub-1" })
  setTimeout(() => reply({ ok: true, info: { id: "xxxxxxxxxxx", url: "https://audio.test/x?worker=" + process.pid + "&n=" + ++answers } }), 50)
}`))
  const run = createYtDlpRunner("/nonexistent-musica-ytdlp", { python: process.execPath, worker })
  assert.equal(await run(["--version"]), "stub-1")
  const first = JSON.parse(await run(["--dump-single-json", "--format", "bestaudio", "--", "https://www.youtube.com/watch?v=xxxxxxxxxxx"], 500))
  const second = JSON.parse(await run(["--dump-single-json", "--format", "bestaudio", "--", "https://www.youtube.com/watch?v=xxxxxxxxxxx"], 500))
  assert.equal(first.id, "xxxxxxxxxxx")
  assert.ok(first.url.startsWith("https://audio.test/x?"))
  // Mismo proceso: el temporizador de una respuesta exitosa no mata al trabajador.
  assert.equal(new URL(second.url).searchParams.get("worker"), new URL(first.url).searchParams.get("worker"))
})

test("una petición sin respuesta la mata por timeout y la siguiente arranca un trabajador nuevo", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "musica-runner-"))
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true })))
  const worker = resolve(dir, "stub-stuck.mjs")
  await writeFile(worker, stubWorker(`
process.stdout.write(JSON.stringify({ event: "ready", version: "stub-1" }) + "\\n")
function handle(request, reply) {
  if (request.op === "version") return reply({ ok: true, version: "stub-1" })
  // Las extracciones no responden nunca.
}`))
  const run = createYtDlpRunner("/nonexistent-musica-ytdlp", { python: process.execPath, worker })
  await assert.rejects(run(["--dump-single-json", "--", "https://www.youtube.com/watch?v=xxxxxxxxxxx"], 200), /tardado demasiado/)
  assert.equal(await run(["--version"], 5_000), "stub-1")
})

test("un trabajador que muere antes de ready degrada al binario CLI", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "musica-runner-"))
  t.after(() => import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true })))
  const worker = resolve(dir, "stub-crash.mjs")
  await writeFile(worker, "process.stderr.write(\"ModuleNotFoundError: No module named 'yt_dlp'\\n\")\nprocess.exit(1)\n")
  await assert.rejects(
    createYtDlpRunner("/nonexistent-musica-ytdlp", { python: process.execPath, worker })(["--version"]),
    /npm run music:setup/,
  )
})
