import { execFile } from "node:child_process"
import { mkdir, writeFile, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const execute = promisify(execFile)
const basePython = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3")
const environment = resolve(root, ".tools", "ytmusic")
const python = resolve(environment, process.platform === "win32" ? "Scripts/python.exe" : "bin/python")
const options = { timeout: 180_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }

try {
  await execute(basePython, ["-c", "import sys; assert sys.version_info >= (3, 10), 'Se requiere Python 3.10 o posterior'"], options)
} catch (error) {
  throw new Error("Instala Python 3.10 o posterior (con venv), o configura PYTHON_BIN con su ejecutable.", { cause: error })
}
console.log("Preparando YouTube Music en .tools/ytmusic…")
await mkdir(dirname(environment), { recursive: true })
// Some distributions omit ensurepip. Bootstrap pip only inside our local venv.
await execute(basePython, ["-m", "venv", "--without-pip", environment], options)
try {
  await execute(python, ["-m", "pip", "--version"], options)
} catch {
  const bootstrap = resolve(environment, "get-pip.py")
  const response = await fetch("https://bootstrap.pypa.io/get-pip.py", { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`No se pudo preparar pip: HTTP ${response.status}`)
  await writeFile(bootstrap, Buffer.from(await response.arrayBuffer()))
  try {
    await execute(python, [bootstrap, "--disable-pip-version-check", "--no-cache-dir"], options)
  } finally { await rm(bootstrap, { force: true }) }
}
await execute(python, ["-m", "pip", "install", "--disable-pip-version-check", "--no-cache-dir", "-r", resolve(root, "server/requirements.txt")], options)
const { stdout } = await execute(python, ["-c", "from importlib.metadata import version; print(version('ytmusicapi'))"], options)
console.log(`ytmusicapi ${stdout.trim()} instalado en ${environment}`)
