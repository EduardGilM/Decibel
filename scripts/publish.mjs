import { spawn, execFile } from "node:child_process"
import { mkdir, realpath, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), ".."))
const execute = promisify(execFile)
const target = "musica:0.0"
const lock = resolve(root, ".tools", "publish.lock")
const controller = new AbortController()

async function publish() {
  // A temporary clean clone must never replace the shared application's build.
  const { stdout } = await execute("tmux", ["display-message", "-p", "-t", target, "#{pane_current_path}"], { signal: controller.signal })
  if (await realpath(stdout.trim()) !== root) {
    throw new Error(`El servicio ${target} usa otra carpeta. Publica desde su carpeta compartida.`)
  }
  const { stdout: branch } = await execute("git", ["branch", "--show-current"], { cwd: root, signal: controller.signal })
  if (branch.trim() !== "main") throw new Error("La publicación compartida debe hacerse desde la rama main.")
  console.log(`Compilando la carpeta compartida: ${root}`)
  await new Promise((done, reject) => {
    const child = spawn("npm", ["run", "build"], { cwd: root, stdio: "inherit", signal: controller.signal, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } })
    child.on("error", reject)
    child.on("exit", (code) => code === 0 ? done() : reject(new Error(`La compilación no ha terminado correctamente (${code}).`)))
  })
  await execute("tmux", ["respawn-pane", "-k", "-t", target, "-c", root, "npm run serve"], { signal: controller.signal })
  const base = `http://127.0.0.1:${process.env.MUSIC_PORT || 3000}`
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline && !controller.signal.aborted) {
    try {
      const response = await fetch(`${base}/api/music/health`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(3000)]) })
      const status = await response.json()
      if (response.ok && status.ok) {
        console.log(`Web y API actualizadas desde la misma carpeta: ${base}`)
        return
      }
    } catch {}
    await new Promise((done) => setTimeout(done, 500))
  }
  throw new Error(`El servicio no está listo. Revisa los logs de tmux (${target}).`)
}

await mkdir(dirname(lock), { recursive: true })
let locked = false
try {
  try { await mkdir(lock); locked = true } catch (error) {
    if (error.code === "EEXIST") throw new Error("Ya hay una publicación en curso desde la carpeta compartida.")
    throw error
  }
  await writeFile(resolve(lock, "pid"), String(process.pid))
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => controller.abort())
  await publish()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  if (locked) await rm(lock, { recursive: true, force: true })
}
