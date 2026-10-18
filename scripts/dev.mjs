import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const children = [
  spawn(process.execPath, ["--env-file-if-exists=.env.local", "server/index.mjs", "--api-only"], { cwd: root, stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", ...process.argv.slice(2)], { cwd: root, stdio: "inherit" }),
]
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill("SIGTERM")
  process.exitCode = code
}
for (const child of children) {
  child.on("error", (error) => { console.error(error.message); stop(1) })
  child.on("exit", (code) => stop(code ?? 0))
}
process.on("SIGINT", () => stop())
process.on("SIGTERM", () => stop())
