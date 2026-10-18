import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createApp } from "./index.mjs"
import { createMusicService } from "./ytdlp.mjs"
import { mapHomeAlbums } from "./ytmusic.mjs"

const album = { browseId: "MPREb_aaaaaaaaaaa", title: "Estreno", artists: [{ name: "Artista", id: "UCaaaaaaaaaaaaaaaaaa" }], thumbnails: [{ url: "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg" }], year: "2026" }
const song = { videoId: "aaaaaaaaaaa", title: "Selección", artists: album.artists, thumbnails: album.thumbnails, album: { id: "MPREb_bbbbbbbbbbb", name: "Descubrimiento" } }
const rows = [{ contents: [album, album, { browseId: "UCaaaaaaaaaaaaaa", title: "Un artista" }, { playlistId: "VLaaaaaaaaaaaaaa", title: "Una lista" }] }, { contents: [song, song, { ...song, videoId: "bbbbbbbbbbb", isAvailable: false }, { ...song, videoId: "ccccccccccc", is_live: true }, { ...song, videoId: "ddddddddddd", album: { id: "../../private", name: "No válido" } }] }]

async function fixture(t, catalog) {
  const dataDir = await mkdtemp(join(tmpdir(), "decibel-home-"))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const music = await createMusicService({ dataDir, catalog, run: async () => { throw new Error("Home must never resolve or download audio") } })
  return { music, dataDir }
}

test("public home maps canonical albums and quick picks, excluding unsupported and unavailable entries", () => {
  const data = mapHomeAlbums(rows)
  assert.deepEqual(data.newest.map((a) => a.id), ["ytm-album:MPREb_aaaaaaaaaaa"])
  assert.deepEqual(data.random.map((a) => a.id), ["ytm-album:MPREb_bbbbbbbbbbb"])
  assert.equal(data.random[0].name, "Descubrimiento")
  assert.equal(data.newest[0].artist, "Artista")
  assert.deepEqual(mapHomeAlbums([null, { contents: [null] }]), { newest: [], random: [] })
  assert.deepEqual(mapHomeAlbums(null), { newest: [], random: [] })
})

test("a fresh library gets real discovery, and concurrent homes share one cached catalogue request without persisting music", async (t) => {
  let calls = 0, finish
  const f = await fixture(t, async (op) => { assert.equal(op, "home"); calls++; return new Promise((done) => { finish = done }) })
  const first = f.music.home(), second = f.music.home()
  await Promise.resolve()
  finish(rows)
  const [a, b] = await Promise.all([first, second])
  assert.deepEqual(a, b)
  assert.equal(a.newest.length, 1)
  assert.equal(a.random.length, 1)
  assert.deepEqual(a.recent, [])
  assert.equal(a.playlists[0].id, "yt-library")
  await f.music.home()
  assert.equal(calls, 1)
  assert.deepEqual(await readdir(f.dataDir), [])
})

test("expiry refreshes discovery, failures retain its last good answer and a later request can recover", async (t) => {
  let now = Date.now(), calls = 0, failed = false
  t.mock.method(Date, "now", () => now)
  const f = await fixture(t, async () => { calls++; if (failed) throw new Error("offline"); return rows })
  const original = await f.music.home()
  now += 16 * 60_000
  failed = true
  assert.deepEqual(await f.music.home(), original)
  failed = false
  assert.deepEqual(await f.music.home(), original)
  assert.equal(calls, 3)
})

test("an unavailable catalogue leaves the existing library usable and does not cache a failed empty response", async (t) => {
  let calls = 0
  const f = await fixture(t, async () => { if (++calls === 1) throw new Error("offline"); return calls === 2 ? [] : rows })
  const empty = await f.music.home()
  assert.deepEqual(empty.newest, [])
  assert.deepEqual(empty.random, [])
  assert.deepEqual((await f.music.home()).newest, [])
  assert.equal((await f.music.home()).newest.length, 1)
  assert.equal(calls, 3)
})

test("HTTP home awaits the catalogue and serializes shelves instead of a Promise", async (t) => {
  const f = await fixture(t, async () => rows)
  const app = await createApp({ music: f.music })
  app.listen(0, "127.0.0.1"); await once(app, "listening")
  t.after(() => new Promise((done) => { app.close(done); app.closeAllConnections() }))
  const response = await fetch(`http://127.0.0.1:${app.address().port}/api/music/home`)
  const home = await response.json()
  assert.equal(response.status, 200)
  assert.equal(home.random[0].id, "ytm-album:MPREb_bbbbbbbbbbb")
  assert.equal(home.newest[0].id, "ytm-album:MPREb_aaaaaaaaaaa")
})
