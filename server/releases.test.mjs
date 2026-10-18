import assert from "node:assert/strict"
import { once } from "node:events"
import { createServer } from "node:http"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createReleases, readManifest } from "./releases.mjs"

const sha = "a".repeat(64)

async function setup(t, manifest) {
  const base = await mkdtemp(join(tmpdir(), "decibel-releases-"))
  const dir = join(base, "releases")
  await mkdir(dir)
  await writeFile(join(base, "secret.txt"), "no")
  await symlink(join(base, "secret.txt"), join(dir, "link.apk"))
  await writeFile(join(dir, "Decibel-0.1.9.apk"), "apk-bytes")
  await writeFile(join(dir, ".hidden"), "x")
  if (manifest) await writeFile(join(dir, "releases.json"), JSON.stringify(manifest))
  const releases = createReleases({ dir })
  const server = createServer(async (req, res) => {
    if (!(await releases.handle(req, res, new URL(req.url, "http://x")))) { res.writeHead(418); res.end() }
  }).listen(0, "127.0.0.1")
  await once(server, "listening")
  t.after(async () => { server.close(); await rm(base, { recursive: true, force: true }) })
  return `http://127.0.0.1:${server.address().port}`
}

const manifest = { version: "0.1.9", versionCode: 1009, date: "2026-10-18T19:00:00Z", notes: "Swipe <b>y</b> escritorio",
  files: { android: { name: "Decibel-0.1.9.apk", sha256: sha, size: 9 }, windows: { name: "../evil.exe", sha256: sha, size: 1 }, "linux-deb": { name: "x.deb", sha256: "zz", size: 1 } } }

test("serves artifacts by plain name only: no traversal, no symlinks out, no dot files", async (t) => {
  const base = await setup(t, manifest)
  const ok = await fetch(base + "/releases/Decibel-0.1.9.apk")
  assert.equal(ok.status, 200)
  assert.equal(await ok.text(), "apk-bytes")
  assert.equal(ok.headers.get("content-type"), "application/vnd.android.package-archive")
  assert.match(ok.headers.get("content-disposition"), /attachment/)
  for (const bad of ["/releases/..%2Fsecret.txt", "/releases/link.apk", "/releases/.hidden", "/releases/%E0%A4%A", "/releases/", "/releases/nope.apk"]) {
    assert.equal((await fetch(base + bad)).status, 404, bad)
  }
  assert.equal((await fetch(base + "/releases/Decibel-0.1.9.apk", { method: "POST" })).status, 418, "only GET/HEAD")
})

test("version endpoint and manifest keep only valid entries", async (t) => {
  const base = await setup(t, manifest)
  const res = await fetch(base + "/api/app/version")
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.versionCode, 1009)
  assert.deepEqual(Object.keys(body.files), ["android"], "invalid names and hashes are dropped")
  assert.equal(await readManifest("/nonexistent"), null)
})

test("download page: one button for the detected system, the rest folded, no hashes or notes, no script", async (t) => {
  const base = await setup(t, { ...manifest, files: { ...manifest.files, windows: { name: "Decibel-0.1.9-setup.exe", sha256: "b".repeat(64), size: 5 } } })
  const page = async (ua) => { const res = await fetch(base + "/download", { headers: { "User-Agent": ua } }); return { res, html: await res.text() } }
  const win = await page("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0")
  assert.equal(win.res.status, 200)
  assert.match(win.html, /Versión 0\.1\.9/)
  assert.match(win.html, /class="main" href="\/releases\/Decibel-0\.1\.9-setup\.exe\?v=bbbbbbbbbbbb" download>Descargar para Windows</)
  assert.match(win.html, /<summary>Otras plataformas<\/summary>[\s\S]*Decibel-0\.1\.9\.apk\?v=aaaaaaaaaaaa/)
  assert.ok(!win.html.includes("sha256") && !win.html.includes("Swipe") && !win.html.includes("SmartScreen") && !win.html.includes("<script"))
  assert.ok(!win.html.includes("evil"))
  assert.match(win.res.headers.get("content-security-policy"), /script-src 'none'/)
  assert.equal(win.res.headers.get("cache-control"), "no-store")
  const android = await page("Mozilla/5.0 (Linux; Android 15; Pixel 8) Chrome/141.0 Mobile")
  assert.match(android.html, /Descargar para Android/)
  const mac = await page("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")
  assert.ok(!mac.html.includes('class="main"'), "no build for macOS: just the list")
  assert.match(mac.html, /class="list open"/)
})

test("without releases the page says so and the version endpoint is 404; no directory disables everything", async (t) => {
  const base = await setup(t, null)
  assert.match(await (await fetch(base + "/download")).text(), /Todavía no hay versiones publicadas/)
  assert.equal((await fetch(base + "/api/app/version")).status, 404)
  const off = createReleases({ dir: undefined })
  assert.equal(await off.handle({ method: "GET" }, {}, new URL("http://x/download")), false)
})
