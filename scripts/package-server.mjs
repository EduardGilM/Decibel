import { spawn, execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs, promisify } from "node:util"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const execute = promisify(execFile)
const { values } = parseArgs({ options: {
  output: { type: "string", default: join(homedir(), "decibel-build/decibel-server.tgz") },
  "node-archive": { type: "string", default: join(homedir(), "decibel-build/node-v22.23.3-linux-x64.tar.xz") },
  python: { type: "string", default: join(root, ".tools/ytmusic/bin/python") },
  "skip-build": { type: "boolean", default: false },
} })
const nodeName = "node-v22.23.3-linux-x64.tar.xz"
const nodeSha = "df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de"
const output = resolve(values.output)
const digest = (buffer) => createHash("sha256").update(buffer).digest("hex")

async function files(base, prefix = "") {
  const result = []
  for (const entry of await readdir(join(base, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name)
    if (entry.isDirectory()) result.push(...await files(base, path))
    else if (entry.isFile()) result.push(path)
  }
  return result.sort()
}

async function sourceDigest() {
  const hash = createHash("sha256")
  const paths = ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json"]
  for (const directory of ["src", "server", "public", "deploy/systemd"]) {
    paths.push(...(await files(join(root, directory))).map((path) => join(directory, path)))
  }
  for (const path of paths.sort()) hash.update(path).update("\0").update(await readFile(join(root, path)))
  return hash.digest("hex")
}

async function run(command, args, options = {}) {
  await new Promise((done, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options })
    child.on("error", reject)
    child.on("exit", (code) => code === 0 ? done() : reject(new Error(`${command} exited with code ${code}`)))
  })
}

const { stdout: branch } = await execute("git", ["branch", "--show-current"], { cwd: root })
if (branch.trim() !== "main") throw new Error("Package from a checkout of the main branch.")
const nodeArchive = await readFile(resolve(values["node-archive"]))
if (digest(nodeArchive) !== nodeSha) throw new Error("The official Node 22.23.3 archive does not match its SHA-256.")
const before = await sourceDigest()
if (!values["skip-build"]) {
  await run("npm", ["run", "build"], { env: {
    ...process.env, NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_DATA_SOURCE: "ytdlp",
    NEXT_PUBLIC_DECIBEL_SERVER: "", NEXT_PUBLIC_YTDLP_URL: "",
  } })
}
await readFile(join(root, "out/index.html"))
await mkdir(dirname(output), { recursive: true })
const staging = await mkdtemp(join(dirname(output), ".decibel-server-"))
const archive = `${staging}.tgz`
try {
  await mkdir(join(staging, "app/server"), { recursive: true })
  await cp(join(root, "out"), join(staging, "app/out"), { recursive: true })
  for (const entry of await readdir(join(root, "server"))) {
    if ((entry.endsWith(".mjs") && !entry.endsWith(".test.mjs")) || entry.endsWith(".py") || entry === "requirements.txt") {
      await cp(join(root, "server", entry), join(staging, "app/server", entry))
    }
  }
  await cp(join(root, "deploy/systemd"), join(staging, "deploy"), { recursive: true })
  await writeFile(join(staging, nodeName), nodeArchive)
  await writeFile(join(staging, "node.sha256"), `${nodeSha}  ${nodeName}\n`)
  await writeFile(join(staging, "app/package.json"), JSON.stringify({
    name: "decibel-server", version: "0.1.0", private: true, engines: { node: ">=22.9.0" },
    dependencies: { "serve-handler": "6.1.7" },
  }, null, 2) + "\n")
  await run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: join(staging, "app") })
  const wheels = join(staging, "runtime/wheels")
  await mkdir(wheels, { recursive: true })
  const python = resolve(values.python)
  await run(python, ["-c", "import sys; assert sys.version_info[:2] == (3, 13), 'Python 3.13 is required to build the bundled wheels' "])
  await run(python, ["-m", "pip", "download", "--quiet", "--disable-pip-version-check", "--no-cache-dir", "--only-binary=:all:", "--dest", wheels, "-r", join(root, "server/requirements.txt")])
  const { stdout: lock } = await execute(python, ["-c", `
import email, hashlib, pathlib, sys, zipfile
for wheel in sorted(pathlib.Path(sys.argv[1]).glob('*.whl')):
    with zipfile.ZipFile(wheel) as archive:
        name = next(n for n in archive.namelist() if n.endswith('.dist-info/METADATA'))
        meta = email.message_from_bytes(archive.read(name))
    name = meta['Name']
    if name.lower().replace('_', '-') == 'yt-dlp': name += '[default]'
    print(f"{name}=={meta['Version']} --hash=sha256:{hashlib.sha256(wheel.read_bytes()).hexdigest()}")
`, wheels])
  if (!lock.trim()) throw new Error("No Python dependencies were downloaded.")
  await writeFile(join(staging, "runtime/requirements.lock"), lock)
  const { stdout: revision } = await execute("git", ["rev-parse", "HEAD"], { cwd: root })
  const { stdout: status } = await execute("git", ["status", "--porcelain"], { cwd: root })
  const after = await sourceDigest()
  if (before !== after) throw new Error("The source tree changed while packaging. Build and package again.")
  await writeFile(join(staging, "app/REVISION"), `${revision.trim()}${status.trim() ? " + cambios de la carpeta compartida" : ""}\n`)
  await writeFile(join(staging, "MANIFEST.json"), JSON.stringify({
    revision: revision.trim(), workingTreeChanges: !!status.trim(), sourceSha256: after,
    builtAt: new Date().toISOString(), target: "Debian 13, Linux x86_64, Python 3.13",
    nodeVersion: "22.23.3", pythonRequirements: lock.trim().split("\n"),
  }, null, 2) + "\n")
  const checksums = []
  for (const path of await files(staging)) checksums.push(`${digest(await readFile(join(staging, path)))}  ${path}`)
  await writeFile(join(staging, "SHA256SUMS"), checksums.join("\n") + "\n")
  await run("tar", ["-czf", archive, "-C", staging, "."])
  const sha = digest(await readFile(archive))
  await rename(archive, output)
  await writeFile(`${output}.sha256`, `${sha}  ${output.split("/").at(-1)}\n`)
  console.log(`Paquete completo: ${output}\nSHA256: ${sha}`)
} finally {
  await rm(staging, { recursive: true, force: true })
  await rm(archive, { force: true })
}
