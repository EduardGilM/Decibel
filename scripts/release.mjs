// Publishes a release to the Decibel server's releases directory (served at /download, /releases/*, /api/app/version).
//   node scripts/release.mjs --version 0.1.9 --apk A.apk --windows S.exe --deb D.deb [--notes "…"] [--publish]
// Environment (nothing is hard-coded):
//   DECIBEL_PUBLIC_URL      https base of the server, e.g. https://music.example.com
//   DECIBEL_RELEASE_TARGET  scp destination of the releases directory, e.g. myserver:/srv/decibel-releases
//   DECIBEL_UPDATER_KEY     Tauri updater private key (file) and DECIBEL_UPDATER_KEY_PASSWORD_FILE; never in git.
// Steps: stage files with canonical names, sign the desktop installers for the updater, write releases.json
// (download page + Android check) and latest.json (Tauri updater), then upload artifacts before the manifests
// and check every served sha256.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { verifyUpdaterSignature } from "./updater-signature.mjs"

const { values } = parseArgs({ options: {
  version: { type: "string" }, apk: { type: "string" }, windows: { type: "string" }, deb: { type: "string" },
  notes: { type: "string", default: "" }, out: { type: "string" }, publish: { type: "boolean", default: false },
} })
const fail = (message) => { console.error(message); process.exit(1) }
const version = values.version ?? fail("--version is required")
if (!/^\d+\.\d+\.\d+$/.test(version)) fail("--version must look like 0.1.9")
const base = (process.env.DECIBEL_PUBLIC_URL || "").replace(/\/+$/, "")
if (!/^https:\/\//.test(base)) fail("Set DECIBEL_PUBLIC_URL=https://…")
const [major, minor, patch] = version.split(".").map(Number)
const out = resolve(values.out || join(homedir(), "decibel-build", `release-${version}`))
mkdirSync(out, { recursive: true })
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex")

const entries = [
  ["android", values.apk, `Decibel-${version}.apk`],
  ["windows", values.windows, `Decibel-${version}-setup.exe`],
  ["linux-deb", values.deb, `Decibel-${version}.deb`],
].filter(([, source]) => source)
if (!entries.length) fail("Pass at least one artifact.")

const files = {}
for (const [key, source, name] of entries) {
  if (!existsSync(source)) fail(`Not found: ${source}`)
  copyFileSync(source, join(out, name))
  files[key] = { name, sha256: sha256(join(out, name)), size: statSync(join(out, name)).size }
}

// Updater signatures (minisign, via the Tauri CLI) for the desktop installers.
const desktop = entries.filter(([key]) => key !== "android")
const signatures = {}
if (desktop.length) {
  const key = process.env.DECIBEL_UPDATER_KEY || join(homedir(), ".decibel-keys", "updater.key")
  const passwordFile = process.env.DECIBEL_UPDATER_KEY_PASSWORD_FILE || `${key}.password`
  if (!existsSync(key)) fail(`Updater private key not found (${key}).`)
  const password = existsSync(passwordFile) ? readFileSync(passwordFile, "utf8").trim() : ""
  for (const [kind, , name] of desktop) {
    const r = spawnSync("npx", ["tauri", "signer", "sign", join(out, name)], { stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PATH: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password } })
    if (r.status !== 0) fail(`Could not sign ${name}`)
    signatures[kind] = readFileSync(join(out, `${name}.sig`), "utf8").trim()
  }
  // Same check the installed apps make: a signature their built-in public key rejects means no update at all.
  const pubFile = process.env.DECIBEL_UPDATER_PUBKEY || `${key}.pub`
  if (!existsSync(pubFile)) fail(`Updater public key not found (${pubFile}).`)
  for (const [kind, , name] of desktop) {
    if (!verifyUpdaterSignature(readFileSync(join(out, name)), signatures[kind], readFileSync(pubFile, "utf8"))) fail(`Updater signature of ${name} does not verify with ${pubFile}`)
    console.log(`  updater signature ${name}: OK`)
  }
}

const date = new Date().toISOString()
writeFileSync(join(out, "releases.json"), JSON.stringify({ version, versionCode: major * 1_000_000 + minor * 1_000 + patch, date, notes: values.notes, files }, null, 2) + "\n")
// ?v=<hash>: a CDN in front of the server (e.g. Cloudflare) can never hand out an older build under this URL.
const url = (kind) => `${base}/releases/${encodeURIComponent(files[kind].name)}?v=${files[kind].sha256.slice(0, 12)}`
const platforms = {}
const platform = (keys, kind) => { if (signatures[kind]) for (const k of keys) platforms[k] = { signature: signatures[kind], url: url(kind) } }
platform(["windows-x86_64", "windows-x86_64-nsis"], "windows")
// No AppImage any more (only .deb). Never map "linux-x86_64": an installed AppImage falls back to that key and
// would overwrite itself with a .deb. Without its key the AppImage updater just finds no update (silent).
platform(["linux-x86_64-deb"], "linux-deb")
writeFileSync(join(out, "latest.json"), JSON.stringify({ version, notes: values.notes, pub_date: date, platforms }, null, 2) + "\n")
// Hashes for whoever wants to check a download (not linked from the page).
writeFileSync(join(out, "SHA256SUMS.txt"), Object.values(files).map((f) => `${f.sha256}  ${f.name}`).join("\n") + "\n")
console.log(`Staged in ${out}`)
for (const [key, f] of Object.entries(files)) console.log(`  ${key.padEnd(15)} ${f.name}  ${f.sha256}`)

if (values.publish) {
  const target = process.env.DECIBEL_RELEASE_TARGET || fail("Set DECIBEL_RELEASE_TARGET=host:/path/to/releases")
  const [host, dir] = [target.slice(0, target.indexOf(":")), target.slice(target.indexOf(":") + 1)]
  if (!host || !dir.startsWith("/")) fail("DECIBEL_RELEASE_TARGET must be host:/absolute/path")
  const sh = (cmd, argv) => { const r = spawnSync(cmd, argv, { stdio: "inherit", timeout: 600_000 }); if (r.status !== 0) fail(`${cmd} failed`) }
  const artifacts = [...Object.values(files).flatMap((f) => [f.name, ...(existsSync(join(out, `${f.name}.sig`)) ? [`${f.name}.sig`] : [])]), "SHA256SUMS.txt"]
  sh("scp", ["-q", "-o", "BatchMode=yes", ...artifacts.map((n) => join(out, n)), `${target}/`])
  // Manifests last, renamed into place, so clients never see a version whose files are not there yet.
  for (const n of ["releases.json", "latest.json"]) copyFileSync(join(out, n), join(out, `${n}.new`))
  sh("scp", ["-q", "-o", "BatchMode=yes", join(out, "releases.json.new"), join(out, "latest.json.new"), `${target}/`])
  const q = (s) => `'${s.replace(/'/g, "'\\''")}'`
  sh("ssh", ["-o", "BatchMode=yes", host, `cd ${q(dir)} && chmod 644 ${artifacts.map(q).join(" ")} releases.json.new latest.json.new && mv releases.json.new releases.json && mv latest.json.new latest.json`])
  let ok = true
  for (const f of Object.values(files)) {
    const res = await fetch(`${base}/releases/${encodeURIComponent(f.name)}?v=${f.sha256.slice(0, 12)}`)
    const served = res.ok ? createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex") : `HTTP ${res.status}`
    console.log(`  served ${f.name}: ${served === f.sha256 ? "sha256 OK" : `MISMATCH (${served})`}`)
    ok &&= served === f.sha256
  }
  const live = await (await fetch(`${base}/api/app/version`)).json().catch(() => null)
  console.log(`  /api/app/version: ${live?.version ?? "?"}`)
  if (!ok || live?.version !== version) fail("Published files do not match.")
  console.log(`Published ${version}: ${base}/download`)
}
