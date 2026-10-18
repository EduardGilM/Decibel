import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

for (const resident of [true, false]) test(`read-only app stores its data and ${resident ? "resident" : "CLI fallback"} cache outside the installation`, async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "decibel-readonly-"))
  const app = join(temporary, "app"), data = join(temporary, "data"), cache = join(temporary, "cache")
  await mkdir(join(app, "server"), { recursive: true })
  for (const file of await readdir(join(root, "server"))) {
    if ((file.endsWith(".mjs") && !file.endsWith(".test.mjs")) || file.endsWith(".py")) {
      await cp(join(root, "server", file), join(app, "server", file))
      await chmod(join(app, "server", file), 0o444)
    }
  }
  await symlink(join(root, "node_modules"), join(app, "node_modules"))
  await chmod(join(app, "server"), 0o555)
  await chmod(app, 0o555)
  t.after(async () => { await chmod(app, 0o755); await chmod(join(app, "server"), 0o755); await rm(temporary, { recursive: true, force: true }) })
  const runtime = join(temporary, "runtime.mjs")
  await writeFile(runtime, `#!${process.execPath}
import { mkdirSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
const args = process.argv.slice(2)
if (args[0] === '-B') { console.log(JSON.stringify({name:'fixture-catalog'})); process.exit(0) }
const worker = args[0].endsWith('ytdlp-worker.py')
if (worker && process.env.FIXTURE_RESIDENT !== 'true') process.exit(1)
const cache = worker ? args[1] : args[args.indexOf('--cache-dir') + 1]
mkdirSync(cache, {recursive:true})
writeFileSync(cache + '/probe.json', JSON.stringify({cache, worker}))
if (!worker) { console.log('fixture-ytdlp'); process.exit(0) }
console.log(JSON.stringify({event:'ready', version:'fixture-ytdlp'}))
createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line)
  console.log(JSON.stringify({id:request.id, ok:true, version:'fixture-ytdlp'}))
})
`)
  await chmod(runtime, 0o755)
  const child = spawn(process.execPath, [join(app, "server/index.mjs"), "--api-only"], { env: {
    ...process.env, MUSIC_HOST: "127.0.0.1", MUSIC_API_PORT: "0", MUSIC_DATA_DIR: join(data, "music"),
    DECIBEL_DB: join(data, "profiles.db"), YTDLP_BIN: runtime, YTMUSIC_PYTHON: runtime,
    YTDLP_CACHE_DIR: cache, FIXTURE_RESIDENT: String(resident),
  }, stdio: ["ignore", "pipe", "pipe"] })
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exit = once(child, "exit"); child.kill(); await exit } })
  let stdout = "", stderr = ""
  child.stderr.on("data", (chunk) => { stderr += chunk })
  const port = await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${stderr}`)), 10_000)
    child.once("error", (error) => { clearTimeout(timer); reject(error) })
    child.once("exit", () => { clearTimeout(timer); reject(new Error(`Server exited: ${stderr}`)) })
    child.stdout.on("data", (chunk) => {
      stdout += chunk
      const match = stdout.match(/http:\/\/localhost:(\d+)/)
      if (match) { clearTimeout(timer); done(Number(match[1])) }
    })
  })
  const response = await fetch(`http://127.0.0.1:${port}/api/music/health`)
  assert.equal(response.status, 200, stderr)
  assert.equal((await response.json()).version, "fixture-ytdlp")
  assert.deepEqual(JSON.parse(await readFile(join(cache, "probe.json"), "utf8")), { cache, worker: resident })
  assert.ok((await readdir(data)).includes("profiles.db"))
  assert.deepEqual(await readdir(app), ["node_modules", "server"])
})
