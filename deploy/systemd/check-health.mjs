import assert from "node:assert/strict"

const base = process.argv[2] || "http://127.0.0.1:3000"
const deadline = Date.now() + 30_000
let error
do {
  try {
    for (const route of ["/api/health", "/api/music/health"]) {
      const response = await fetch(base + route, { signal: AbortSignal.timeout(4000) })
      const body = await response.json()
      assert.ok(response.ok && body.ok, `${route}: HTTP ${response.status}`)
    }
    assert.equal((await fetch(base + "/api/music/home", { signal: AbortSignal.timeout(4000) })).status, 401)
    assert.equal((await fetch(base + "/api/auth/profiles", { signal: AbortSignal.timeout(4000) })).status, 401)
    assert.equal((await fetch(base + "/api/podcasts/follows", { signal: AbortSignal.timeout(4000) })).status, 401)
    assert.equal((await fetch(base + "/api/podcasts/top?country=ES", { signal: AbortSignal.timeout(4000) })).status, 401)
    const preflight = await fetch(base + "/api/music/prepare", {
      method: "OPTIONS",
      headers: { Origin: "https://tauri.localhost", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Authorization, Content-Type" },
      signal: AbortSignal.timeout(4000),
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://tauri.localhost")
    assert.match(preflight.headers.get("access-control-allow-headers"), /authorization/i)
    const podcastPreflight = await fetch(base + "/api/podcasts/audio", {
      method: "OPTIONS",
      headers: { Origin: "https://tauri.localhost", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Authorization, Range, If-Range" },
      signal: AbortSignal.timeout(4000),
    })
    assert.equal(podcastPreflight.status, 204)
    assert.equal(podcastPreflight.headers.get("access-control-allow-origin"), "https://tauri.localhost")
    assert.match(podcastPreflight.headers.get("access-control-allow-headers"), /\bRange\b/)
    assert.match(podcastPreflight.headers.get("access-control-expose-headers"), /Content-Range/)
    assert.equal((await fetch(base + "/api/music/stream?id=invalid", {
      headers: { "X-Decibel-Purpose": "download" }, signal: AbortSignal.timeout(4000),
    })).status, 401)
    assert.equal((await fetch(base + "/", { signal: AbortSignal.timeout(4000) })).status, 200)
    console.log("Web app, profiles, yt-dlp and catalogue are up; session, CORS and authenticated audio verified.")
    process.exit(0)
  } catch (caught) { error = caught }
  await new Promise((resolve) => setTimeout(resolve, 500))
} while (Date.now() < deadline)
console.error(error?.message || "The service is not available")
process.exitCode = 1
