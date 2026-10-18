// Desktop builds (Tauri): Linux AppImage + .deb and Windows NSIS (cross-compiled from Linux with cargo-xwin).
//   DECIBEL_SERVER=https://music.example.com node scripts/build-desktop.mjs [--linux] [--windows] [--skip-web]
// - The web build points to DECIBEL_SERVER (same as the Android build) and is placed in `out/`.
// - Updates: endpoint `<DECIBEL_UPDATE_URL or DECIBEL_SERVER>/releases/latest.json` and the updater PUBLIC key
//   from DECIBEL_UPDATER_PUBKEY (file). Both are injected with `--config`; nothing is committed. Without a key
//   the app is built without self-update. Updater signatures are made later by scripts/release.mjs.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const args = new Set(process.argv.slice(2))
const server = (process.env.DECIBEL_SERVER || "").replace(/\/+$/, "")
if (!/^https:\/\//.test(server)) { console.error("Set DECIBEL_SERVER=https://… (the Decibel server the app will use)."); process.exit(1) }
const updateBase = (process.env.DECIBEL_UPDATE_URL || server).replace(/\/+$/, "")
const run = (cmd, argv, env = {}) => {
  console.log(`$ ${cmd} ${argv.join(" ")}`)
  const r = spawnSync(cmd, argv, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

if (!args.has("--skip-web")) {
  run("npx", ["next", "build"], { NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_DATA_SOURCE: "ytdlp", NEXT_PUBLIC_DECIBEL_SERVER: server, NEXT_PUBLIC_YTDLP_URL: server, NEXT_PUBLIC_UPDATE_URL: updateBase })
}
const config = { build: { beforeBuildCommand: "" } }
const keyFile = process.env.DECIBEL_UPDATER_PUBKEY
if (keyFile && existsSync(keyFile)) {
  config.plugins = { updater: { pubkey: readFileSync(keyFile, "utf8").trim(), endpoints: [`${updateBase}/releases/latest.json`], windows: { installMode: "passive" } } }
} else console.warn("No DECIBEL_UPDATER_PUBKEY: building without self-update.")
const configFile = join(root, "src-tauri", "tauri.desktop.json") // git-ignored
writeFileSync(configFile, JSON.stringify(config, null, 2))
const linux = args.has("--linux") || !args.has("--windows")
const windows = args.has("--windows") || !args.has("--linux")
if (linux) run("npx", ["tauri", "build", "--bundles", "appimage,deb", "--config", configFile])
if (windows) run("npx", ["tauri", "build", "--runner", "cargo-xwin", "--target", "x86_64-pc-windows-msvc", "--bundles", "nsis", "--config", configFile])
console.log("Bundles in src-tauri/target/{release,x86_64-pc-windows-msvc/release}/bundle/")
