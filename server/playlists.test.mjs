import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createApp } from "./index.mjs"
import { createMusicService } from "./ytdlp.mjs"

const song = (id) => ({ videoId: id, title: `Canción ${id}`, artists: [{ name: "Artista" }], album: { id: "MPREb_aaaaaaaaaaa", name: "Álbum" }, duration_seconds: 30, thumbnails: [{ url: "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg" }] })

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), "decibel-playlists-"))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  const calls = []
  const options = { dataDir, run: async () => { throw new Error("Saving a playlist must not resolve or download audio") }, catalog: async (operation, id) => { if (operation === "home") return []; calls.push([operation, id]); assert.equal(operation, "song"); return song(id) } }
  return { music: await createMusicService(options), dataDir, options, calls }
}

test("created lists persist ordered songs and favourites across restarts, without duplicate additions or audio", async (t) => {
  const f = await fixture(t)
  const list = await f.music.createPlaylist("  Para el coche  ", "yt:aaaaaaaaaaa")
  assert.equal(list.name, "Para el coche")
  assert.equal(list.editable, true)
  assert.equal(list.songCount, 1)
  assert.equal(f.music.playlists()[0].editable, false)
  await Promise.all([f.music.addToPlaylist(list.id, "aaaaaaaaaaa"), f.music.addToPlaylist(list.id, "yt:aaaaaaaaaaa")])
  await f.music.addToPlaylist(list.id, "bbbbbbbbbbb")
  await f.music.star("yt:aaaaaaaaaaa", "track", true)
  const restarted = await createMusicService(f.options)
  const saved = restarted.playlist(list.id)
  assert.deepEqual(saved.tracks.map((track) => track.id), ["yt:aaaaaaaaaaa", "yt:bbbbbbbbbbb"])
  assert.equal(saved.tracks[0].starred, true)
  assert.equal(saved.coverArt, song("aaaaaaaaaaa").thumbnails[0].url)
  assert.equal(saved.duration, 60)
  assert.equal(saved.songCount, 2)
  assert.ok((await restarted.home()).playlists.some((playlist) => playlist.id === list.id))
  assert.deepEqual(await readdir(f.dataDir), ["library.json"])
  const contents = await readFile(join(f.dataDir, "library.json"), "utf8")
  const stored = JSON.parse(contents)
  assert.ok(Object.values(stored.tracks).every((entry) => entry.plays === 0 && entry.lastPlayed === 0))
  assert.ok(!contents.includes("googlevideo"))
  assert.deepEqual(f.calls, [["song", "aaaaaaaaaaa"], ["song", "bbbbbbbbbbb"]])
})

test("empty and concurrent creations survive and legacy metadata is preserved", async (t) => {
  const f = await fixture(t)
  const legacy = { tracks: {}, likes: { track: [], album: [], artist: [] } }
  await writeFile(join(f.dataDir, "library.json"), JSON.stringify(legacy))
  const music = await createMusicService(f.options)
  const lists = await Promise.all([music.createPlaylist("Una lista"), music.createPlaylist("Otra lista")])
  assert.notEqual(lists[0].id, lists[1].id)
  assert.ok(lists.every((list) => list.songCount === 0 && list.duration === 0 && list.editable))
  const restarted = await createMusicService(f.options)
  assert.deepEqual(restarted.playlists().filter((list) => list.editable).map((list) => list.name), ["Una lista", "Otra lista"])
  const stored = JSON.parse(await readFile(join(f.dataDir, "library.json"), "utf8"))
  assert.deepEqual(stored.likes, legacy.likes)
  assert.deepEqual(stored.tracks, legacy.tracks)
})

test("validation and automatic lists cannot create orphan collections or change stored metadata", async (t) => {
  const f = await fixture(t)
  for (const name of [undefined, "", "   ", 123, "x".repeat(81), "Una\nlista"]) await assert.rejects(f.music.createPlaylist(name), { status: 400 })
  await assert.rejects(f.music.createPlaylist("Válida", "../../private"), { status: 400 })
  await assert.rejects(f.music.addToPlaylist("yt-library", "aaaaaaaaaaa"), { status: 403 })
  await assert.rejects(f.music.addToPlaylist("missing", "aaaaaaaaaaa"), { status: 404 })
  assert.equal(f.music.playlists().length, 1)
  assert.deepEqual(await readdir(f.dataDir), [])
  assert.deepEqual(f.calls, [])
})

test("playlist creation and additions are available over HTTP with origin and input checks", async (t) => {
  const f = await fixture(t)
  const app = await createApp({ music: f.music })
  app.listen(0, "127.0.0.1")
  await once(app, "listening")
  t.after(() => new Promise((resolve) => { app.close(resolve); app.closeAllConnections() }))
  const base = `http://127.0.0.1:${app.address().port}/api/music/`
  const post = (route, body, headers = {}) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) })
  const created = await post("playlists", { name: "Rock", id: "yt:aaaaaaaaaaa" })
  assert.equal(created.status, 201)
  const list = await created.json()
  const added = await post("playlist-tracks", { playlistId: list.id, id: "yt:bbbbbbbbbbb" })
  assert.equal(added.status, 200)
  assert.equal((await added.json()).songCount, 2)
  const playlists = await (await fetch(base + "playlists")).json()
  assert.deepEqual(playlists.filter((playlist) => playlist.editable).map((playlist) => playlist.id), [list.id])
  assert.equal((await post("playlists", { name: "" })).status, 400)
  assert.equal((await post("playlist-tracks", { playlistId: "yt-library", id: "aaaaaaaaaaa" })).status, 403)
  assert.equal((await post("playlists", { name: "Forbidden" }, { Origin: "https://evil.test" })).status, 403)
  assert.equal((await post("playlists", { name: "Invalid" }, { "Content-Type": "text/plain" })).status, 415)
  assert.equal(f.music.playlists().length, 2)
})
