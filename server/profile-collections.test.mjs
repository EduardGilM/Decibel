import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { openDb } from "./db.mjs"
import { createApp } from "./index.mjs"
import { createProfileApi } from "./profile-api.mjs"
import { createMusicService } from "./ytdlp.mjs"
import { MusicError } from "./errors.mjs"

const song = (n) => ({ videoId: `vid${String(n).padStart(8, "0")}`.slice(0, 11), title: `Tema ${n}`, artists: [{ name: `Artista ${n}`, id: `UC${String(n).padStart(22, "a")}` }], album: { name: `Álbum ${n}`, id: `MPREb_${String(n).padStart(11, "a")}` }, duration_seconds: 100, thumbnails: [{ url: "https://example.com/a.jpg", width: 500 }] })
const yt = (n) => ({ id: `yt:${song(n).videoId}`, title: `Tema ${n}`, artist: `Artista ${n}`, artistId: `yt-artist:${song(n).artists[0].id}`, album: `Álbum ${n}`, albumId: `yt-album:${song(n).album.id}`, duration: 100, coverArt: "https://example.com/a.jpg" })

async function setup(t, catalog) {
  const dataDir = await mkdtemp(join(tmpdir(), "musica-profiles-"))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const run = async (args) => {
    if (args.includes("--version")) return "test"
    return JSON.stringify({ id: song(1).videoId, title: "x", duration: 100, url: "https://audio.googlevideo.com/videoplayback?expire=4102444800" })
  }
  const music = await createMusicService({ dataDir, run, catalog: catalog ?? (async (operation) => operation === "home" ? [] : operation === "search" ? [song(1)] : ["searchAlbums", "searchArtists"].includes(operation) ? [] : song(1)) })
  const profiles = await createProfileApi({ db: openDb(":memory:"), seed: ["Alex", "Blanca", "Carlos"].map((username) => ({ username, role: "user", password: username })) })
  const app = await createApp({ music, profiles })
  app.listen(0, "127.0.0.1")
  await once(app, "listening")
  t.after(() => new Promise((resolve) => { app.close(resolve); app.closeAllConnections() }))
  const base = `http://127.0.0.1:${app.address().port}`
  const call = async (path, { token, method = "GET", body } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers }
  }
  const login = async (username) => (await call("/api/auth/login", { method: "POST", body: { username, password: username } })).body.token
  return { call, login, music }
}

test("each profile sees only its own albums, artists, Home and favourites", async (t) => {
  const { call, login } = await setup(t)
  const alex = await login("Alex")
  const carlos = await login("Carlos")
  // Alex plays a song (the legacy shared library records it) and likes an album.
  assert.equal((await call("/api/music/stream", { token: alex, method: "POST", body: { id: yt(1).id } })).status, 200)
  assert.equal((await call("/api/me/history", { token: alex, method: "POST", body: { source: "ytdlp", track: yt(1), playedAt: Date.now(), listened: true } })).status, 201)
  const liked = { id: yt(2).albumId, name: "Álbum 2", artist: "Artista 2", coverArt: "https://example.com/a.jpg", songCount: 1 }
  assert.equal((await call("/api/me/likes", { token: alex, method: "PUT", body: { source: "ytdlp", kind: "album", item: liked } })).status, 200)

  const mine = await call("/api/music/albums?type=alphabeticalByName", { token: alex })
  assert.deepEqual(mine.body.map((a) => a.id).sort(), [yt(1).albumId, yt(2).albumId].sort())
  assert.deepEqual((await call("/api/music/albums?type=recent", { token: alex })).body.map((a) => a.id), [yt(1).albumId])
  assert.deepEqual((await call("/api/music/artists", { token: alex })).body.map((a) => a.id), [yt(1).artistId])
  const home = (await call("/api/music/home", { token: alex })).body
  assert.deepEqual(home.recent.map((a) => a.id), [yt(1).albumId])
  assert.deepEqual(home.playlists, [])

  // Carlos shares the server but none of Alex's library.
  assert.deepEqual((await call("/api/music/albums?type=alphabeticalByName", { token: carlos })).body, [])
  assert.deepEqual((await call("/api/music/artists", { token: carlos })).body, [])
  const other = (await call("/api/music/home", { token: carlos })).body
  for (const shelf of ["recent", "newest", "frequent", "random", "artists", "playlists"]) assert.deepEqual(other[shelf], [], shelf)
  assert.deepEqual((await call("/api/music/playlists", { token: carlos })).body, [])
  assert.equal((await call("/api/music/playlist?id=yt-library", { token: carlos })).status, 404)
  assert.deepEqual((await call("/api/music/starred", { token: carlos })).body, { tracks: [], albums: [], artists: [] })
  assert.deepEqual((await call("/api/music/starred", { token: alex })).body.albums.map((a) => a.id), [yt(2).albumId])
})

test("a full search shows what it found when one catalogue lookup fails", async (t) => {
  const failing = new Set(["searchAlbums"])
  const catalog = async (operation) => {
    if (failing.has(operation)) throw Object.assign(new MusicError("No se pudo consultar YouTube Music. Vuelve a intentarlo.", 503), { retryAfter: 5 })
    return operation === "search" ? [song(1)] : operation === "searchArtists" ? [] : song(1)
  }
  const { call, login } = await setup(t, catalog)
  const token = await login("Blanca")
  const partial = await call("/api/music/search?q=tema&type=all", { token })
  assert.equal(partial.status, 200)
  assert.deepEqual(partial.body.tracks.map((track) => track.id), [yt(1).id])
  assert.deepEqual(partial.body.albums, [])

  // Only when every lookup fails does the search fail, as a 503 the proxy passes through with its JSON.
  failing.add("search").add("searchArtists")
  const failed = await call("/api/music/search?q=otra&type=all", { token })
  assert.equal(failed.status, 503)
  assert.equal(failed.headers.get("retry-after"), "5")
  assert.match(failed.body.error, /YouTube Music/)
})
