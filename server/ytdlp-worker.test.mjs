import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { access, constants } from "node:fs/promises"
import { resolve } from "node:path"
import test from "node:test"

const root = resolve(import.meta.dirname, "..")
const python = resolve(root, ".tools/ytmusic/bin/python")
const worker = resolve(root, "server/ytdlp-worker.py")

// It really extracts from YouTube: only on explicit request, never in the normal suite or a release.
// (`npm test -- --test-skip-pattern=…` does not skip it: Node ignores that option after the file list.)
const requested = process.env.DECIBEL_REAL_YTDLP === "1"
const withYtDlp = requested && await access(python, constants.X_OK).then(async () => new Promise((resolveResult) => {
  execFile(python, ["-c", "import yt_dlp, yt_dlp_ejs"], (error) => resolveResult(!error))
})).catch(() => false)

test("el trabajador real resuelve la URL con el reto JS de YouTube resuelto", { skip: requested ? !withYtDlp && "requiere .tools/ytmusic con yt-dlp[default] (npm run music:setup)" : "solo con DECIBEL_REAL_YTDLP=1 (extrae de verdad de YouTube)" }, async (t) => {
  const proc = spawn(python, [worker, resolve(root, ".tools/yt-dlp-cache"), process.execPath], { stdio: ["pipe", "pipe", "pipe"] })
  t.after(() => proc.kill("SIGKILL"))
  proc.stderr.on("data", () => {})
  const ready = new Promise((resolveReady, rejectReady) => proc.stdout.once("data", (chunk) => {
    const message = JSON.parse(chunk.toString())
    if (message.event === "ready") resolveReady(message)
    else rejectReady(new Error("El trabajador no arrancó"))
  }))
  assert.ok((await ready).version)

  const answer = await new Promise((resolveResult, reject) => {
    const timer = setTimeout(() => reject(new Error("skip: YouTube no respondió a tiempo")), 45_000)
    const onChunk = (chunk) => {
      const message = JSON.parse(chunk.toString())
      if (message.id !== 1) return
      proc.stdout.off("data", onChunk)
      clearTimeout(timer)
      resolveResult(message)
    }
    proc.stdout.on("data", onChunk)
    proc.stdin.write(`${JSON.stringify({ id: 1, op: "extract", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", direct: true })}\n`)
  })
  // Sin js_runtimes + ejs el extractor descarta los formatos y no hay URL: esta es la regresión.
  if (answer.ok === false && /tardado|timed out|socket|urllib|reset by peer/i.test(answer.error)) return t.skip("red no disponible")
  assert.equal(answer.ok, true, answer.error)
  assert.ok(answer.info.url?.startsWith("https://"))
  assert.ok(answer.info.duration > 0)
})
