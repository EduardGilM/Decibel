import { createReadStream } from "node:fs"
import { readFile, realpath, stat } from "node:fs/promises"
import { join, sep } from "node:path"

/**
 * Public downloads and app updates, served from a releases directory outside git (`DECIBEL_RELEASES_DIR`,
 * root-owned and read-only for the service). The release script (scripts/release.mjs) writes there:
 * - the artifacts (APK, Windows installer, .deb; AppImage only in old releases) and their updater signatures (`*.sig`);
 * - `releases.json`: current version, versionCode and every file with its sha256 (download page, Android check);
 * - `latest.json`: the Tauri updater manifest for the desktop apps.
 * Routes (no session needed: nothing here is secret): `GET /download`, `GET /releases/<file>`, `GET /api/app/version`.
 */

const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const TYPES = {
  ".apk": "application/vnd.android.package-archive",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".appimage": "application/octet-stream",
  ".deb": "application/vnd.debian.binary-package",
  ".json": "application/json; charset=utf-8",
  ".sig": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
}
const PLATFORMS = [
  { key: "android", label: "Android", detail: "APK · Android 7 o posterior" },
  { key: "windows", label: "Windows", detail: "Instalador · Windows 10/11 (64 bits)" },
  { key: "linux-appimage", label: "Linux", detail: "AppImage · x86_64" },
  { key: "linux-deb", label: "Linux (.deb)", detail: "Debian / Ubuntu · x86_64" },
]

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
const formatSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/** Only plain names (no paths, no dot files) that exist as regular files inside the directory. */
async function resolveFile(dir, name) {
  if (!FILE.test(name) || name.includes("..")) return null
  try {
    const root = await realpath(dir)
    const path = await realpath(join(root, name))
    if (!path.startsWith(root + sep)) return null
    const info = await stat(path)
    return info.isFile() ? { path, size: info.size } : null
  } catch { return null }
}

/** releases.json, validated so a broken file never breaks the page. */
export async function readManifest(dir) {
  try {
    const data = JSON.parse(await readFile(join(dir, "releases.json"), "utf8"))
    if (typeof data?.version !== "string" || !Number.isInteger(data.versionCode) || typeof data.files !== "object") return null
    const files = {}
    for (const { key } of PLATFORMS) {
      const f = data.files[key]
      if (f && FILE.test(f.name) && /^[a-f0-9]{64}$/.test(f.sha256) && Number.isInteger(f.size)) files[key] = { name: f.name, sha256: f.sha256, size: f.size }
    }
    return { version: data.version, versionCode: data.versionCode, date: typeof data.date === "string" ? data.date : null, notes: typeof data.notes === "string" ? data.notes : "", files }
  } catch { return null }
}

/** Which build to offer first, from the browser's user agent (server side: the page needs no script). */
export function detectPlatform(userAgent = "") {
  if (/Android/i.test(userAgent)) return "android"
  if (/Windows/i.test(userAgent)) return "windows"
  if (/Linux|X11|CrOS/i.test(userAgent)) return "linux-deb"
  return null
}

const LABEL = { android: "Android", windows: "Windows", "linux-appimage": "Linux", "linux-deb": "Linux (.deb)" }

/**
 * Minimal download page: logo, name, version and one big button for the detected system; «Otras plataformas»
 * unfolds the rest. Hashes live in SHA256SUMS.txt. Links carry ?v=<hash> so a CDN never serves an old build.
 */
export function downloadPage(manifest, userAgent = "") {
  const href = (f) => `/releases/${encodeURIComponent(f.name)}?v=${f.sha256.slice(0, 12)}`
  const available = manifest ? PLATFORMS.filter(({ key }) => manifest.files[key]) : []
  if (!manifest || !available.length) return page(`<p class="version">Todavía no hay versiones publicadas.</p>`)
  const detected = detectPlatform(userAgent)
  const primary = available.find(({ key }) => key === detected) ?? null
  const others = available.filter((p) => p !== primary)
  const link = ({ key }) => `<a class="other" href="${href(manifest.files[key])}" download>${escape(LABEL[key])}<span>${escape(formatSize(manifest.files[key].size))}</span></a>`
  return page(`<p class="version">Versión ${escape(manifest.version)}</p>
${primary ? `<a class="main" href="${href(manifest.files[primary.key])}" download>Descargar para ${escape(LABEL[primary.key].replace(" (.deb)", ""))}</a>` : ""}
${others.length ? (primary
    ? `<details><summary>Otras plataformas</summary><div class="list">${others.map(link).join("")}</div></details>`
    : `<div class="list open">${others.map(link).join("")}</div>`) : ""}`)
}

function page(body) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Descargar Decibel</title><meta name="color-scheme" content="dark"><meta name="robots" content="noindex">
<link rel="icon" href="/favicon.png">
<style>
:root{--bg:#0b0b0b;--card:#181818;--fg:#f5f5f5;--muted:#a3a3a3;--accent:#1ed760}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:grid;place-items:center}
main{width:100%;max-width:420px;padding:40px 24px;display:flex;flex-direction:column;align-items:center;text-align:center}
img{width:88px;height:88px}h1{font-size:34px;margin:14px 0 0;letter-spacing:-.02em}.version{color:var(--muted);margin:2px 0 28px}
.main{display:block;width:100%;padding:16px 24px;border-radius:999px;background:var(--accent);color:#000;font-weight:700;font-size:17px;text-decoration:none}
.main:hover{filter:brightness(1.08)}.main:focus-visible,.other:focus-visible,summary:focus-visible{outline:2px solid #fff;outline-offset:3px}
details{margin-top:18px;width:100%}summary{cursor:pointer;color:var(--muted);font-size:13px;list-style:none;display:inline-block}summary::-webkit-details-marker{display:none}summary:hover{color:var(--fg);text-decoration:underline}
.list{display:flex;flex-direction:column;gap:8px;margin-top:14px;width:100%}
.other{display:flex;justify-content:space-between;padding:12px 18px;border-radius:999px;background:var(--card);color:inherit;text-decoration:none;font-weight:600}.other:hover{background:#222}.other span{color:var(--muted);font-weight:400;font-size:13px}
</style></head><body><main>
<img src="/brand/decibel-mark-symmetric.svg" alt=""><h1>Decibel</h1>
${body}
</main></body></html>`
}

const PAGE_CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

export function createReleases({ dir }) {
  const pageHeaders = () => {
    return {
      "Content-Type": "text/html; charset=utf-8",
      // Depends on the user agent and on the latest release: never cached by the CDN or the browser.
      "Cache-Control": "no-store",
      Vary: "User-Agent",
      "Content-Security-Policy": PAGE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    }
  }
  return {
    /** Returns true if it answered the request. */
    async handle(req, res, url) {
      if (!dir || !["GET", "HEAD"].includes(req.method)) return false
      if (url.pathname === "/download" || url.pathname === "/download/") {
        const html = downloadPage(await readManifest(dir), req.headers["user-agent"])
        res.writeHead(200, pageHeaders())
        res.end(req.method === "HEAD" ? undefined : html)
        return true
      }
      if (url.pathname === "/api/app/version") {
        const manifest = await readManifest(dir)
        res.writeHead(manifest ? 200 : 404, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" })
        res.end(req.method === "HEAD" ? undefined : JSON.stringify(manifest ?? { error: "No hay versiones publicadas." }))
        return true
      }
      if (!url.pathname.startsWith("/releases/")) return false
      let name
      try { name = decodeURIComponent(url.pathname.slice("/releases/".length)) } catch { name = "" }
      const file = await resolveFile(dir, name)
      if (!file) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" })
        res.end("No encontrado")
        return true
      }
      const ext = name.slice(name.lastIndexOf(".")).toLowerCase()
      const manifestFile = name === "latest.json" || name === "releases.json" || name === "SHA256SUMS.txt"
      res.writeHead(200, {
        "Content-Type": TYPES[ext] || "application/octet-stream",
        "Content-Length": file.size,
        "Cache-Control": manifestFile ? "no-cache" : "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        ...(ext === ".json" || ext === ".sig" || ext === ".txt" ? {} : { "Content-Disposition": `attachment; filename="${name}"` }),
      })
      if (req.method === "HEAD") { res.end(); return true }
      createReadStream(file.path).on("error", () => res.destroy()).pipe(res)
      return true
    },
  }
}

