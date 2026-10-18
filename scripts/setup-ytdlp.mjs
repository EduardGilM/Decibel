import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, writeFile, chmod, rename, rm, symlink } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const assets = {
  "linux-x64": "yt-dlp_linux",
  "linux-arm64": "yt-dlp_linux_aarch64",
  "linux-arm": "yt-dlp_linux_armv7l",
  "darwin-x64": "yt-dlp_macos",
  "darwin-arm64": "yt-dlp_macos",
  "win32-x64": "yt-dlp.exe",
  "win32-arm64": "yt-dlp_arm64.exe",
}
const executable = assets[`${process.platform}-${process.arch}`]
if (!executable) throw new Error("Plataforma no soportada. Instala yt-dlp y configura YTDLP_BIN.")
// Linux's single-file binary unpacks its Python runtime on every song resolution.
const unpacked = process.platform === "linux"
const asset = unpacked ? `${executable}.zip` : executable
const base = "https://github.com/yt-dlp/yt-dlp/releases/latest/download"
const destination = resolve(root, ".tools", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp")
const execute = promisify(execFile)

async function download(name) {
  const response = await fetch(`${base}/${name}`, { signal: AbortSignal.timeout(180_000) })
  if (!response.ok) throw new Error(`No se pudo descargar ${name}: HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

console.log(`Descargando ${asset} desde las releases oficiales de yt-dlp…`)
const [binary, checksums] = await Promise.all([download(asset), download("SHA2-256SUMS")])
const expected = checksums.toString().split("\n").find((line) => line.trim().split(/\s+/)[1] === asset)?.split(/\s+/)[0]
const digest = createHash("sha256").update(binary).digest("hex")
if (!expected || digest !== expected) {
  throw new Error("La suma SHA256 de yt-dlp no coincide. No se ha instalado el binario.")
}
await mkdir(dirname(destination), { recursive: true })
const temporary = await mkdtemp(resolve(dirname(destination), ".yt-dlp-"))
const staged = resolve(temporary, "command")
try {
  if (unpacked) {
    const archive = resolve(temporary, "release.zip")
    const contents = resolve(temporary, "contents")
    await writeFile(archive, binary)
    await execute(process.env.PYTHON_BIN || "python3", ["-c", `
import pathlib, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    for entry in archive.infolist():
        path = pathlib.PurePosixPath(entry.filename)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError("Ruta no válida en la distribución de yt-dlp")
    archive.extractall(sys.argv[2])
`, archive, contents], { timeout: 60_000, windowsHide: true })
    await chmod(resolve(contents, executable), 0o755)
    // Keep each verified runtime in place so an update cannot break an active process.
    const runtime = resolve(dirname(destination), "yt-dlp-runtime", digest)
    await mkdir(dirname(runtime), { recursive: true })
    try { await rename(contents, runtime) } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error
    }
    const command = resolve(runtime, executable)
    await execute(command, ["--version"], { timeout: 15_000, windowsHide: true })
    // This link is relative to its final location, after the atomic rename below.
    await symlink(relative(dirname(destination), command), staged)
  } else {
    await writeFile(staged, binary)
    await chmod(staged, 0o755)
  }
  await rename(staged, destination)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
console.log(`yt-dlp instalado en ${destination}`)
