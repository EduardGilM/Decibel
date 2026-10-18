import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createApp } from "./index.mjs"
import { createMusicService, createYtDlpRunner, searchTarget, videoId } from "./ytdlp.mjs"
import { createYtMusicRunner } from "./ytmusic.mjs"

const info = { id: "BaW_jenozKc", title: "Prueba de audio", uploader: "Canal de prueba", duration: 10, url: "https://audio.googlevideo.com/videoplayback?expire=4102444800" }
const song = { videoId: info.id, title: "Título del catálogo", artists: [{ name: "Artista de prueba", id: "UCaaaaaaaaaaaaaaaaaaaaaa" }], album: { name: "Álbum de prueba", id: "MPREb_aaaaaaaaaaa" }, duration_seconds: 10, thumbnails: [{ url: "https://example.com/album.jpg", width: 500 }] }
const defaultCatalog = async (operation) => operation === "health" ? { name: "ytmusicapi", version: "test" } : operation === "search" ? [song] : ["searchAlbums", "searchArtists"].includes(operation) ? [] : song

async function fixture(t, runner, catalog = defaultCatalog) {
  const dataDir = await mkdtemp(join(tmpdir(), "musica-test-"))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  let resolutions = 0
  const run = runner || (async (args) => {
    if (args.includes("--version")) return "test-version"
    if (args.includes("--format")) {
      resolutions++
      assert.ok(args.includes("--skip-download"))
      assert.ok(!args.includes("--output"))
      return JSON.stringify({ ...info, url: `${info.url}&request=${resolutions}` })
    }
    return JSON.stringify(args.includes("--flat-playlist") ? { entries: [info] } : info)
  })
  const music = await createMusicService({ dataDir, run, catalog })
  return { music, dataDir, run, catalog, resolutions: () => resolutions }
}

test("only canonical YouTube video URLs reach the resolver", () => {
  for (const url of [`https://youtu.be/${info.id}?si=test`, `https://www.youtube.com/watch?v=${info.id}&list=abc`, `music.youtube.com/watch?v=${info.id}`, `https://youtube.com/shorts/${info.id}`]) {
    assert.deepEqual(searchTarget(url), { target: `https://www.youtube.com/watch?v=${info.id}`, flat: false })
  }
  assert.equal(searchTarget("--exec touch /tmp/example").target, "ytsearch12:--exec touch /tmp/example")
  for (const url of ["https://localhost/private", "https://youtube.com.evil.test/watch?v=BaW_jenozKc", "https://user:pass@youtube.com/watch?v=BaW_jenozKc", "https://youtube.com/playlist?list=123", "https://youtube.com:8080/watch?v=BaW_jenozKc"]) assert.throws(() => searchTarget(url))
  for (const id of ["../../etc/passwd", "", null, "12345678901/../a"]) assert.throws(() => videoId(id))
})

test("streaming persists only metadata and favourites, and renews the URL after restart", async (t) => {
  const f = await fixture(t)
  const result = await f.music.search("una canción")
  assert.equal(result.tracks[0].id, `yt:${info.id}`)
  await f.music.star(result.tracks[0].id, "track", true)
  assert.equal(f.music.starred().tracks.length, 1)
  const stream = await f.music.stream(info.id)
  assert.equal(stream.url, `${info.url}&request=1`)
  assert.deepEqual(await readdir(f.dataDir), ["library.json"])
  assert.ok(!(await readFile(join(f.dataDir, "library.json"), "utf8")).includes("googlevideo"))
  await f.music.scrobble(info.id, true)
  assert.equal(stream.track.title, song.title)
  assert.equal(stream.track.artist, "Artista de prueba")
  assert.equal(stream.track.albumId, `ytm-album:${song.album.id}`)
  assert.equal(stream.track.coverArt, song.thumbnails[0].url)
  const restarted = await createMusicService({ dataDir: f.dataDir, run: f.run, catalog: f.catalog })
  assert.equal((await restarted.home()).frequent.length, 1)
  assert.equal(restarted.starred().tracks[0].title, song.title)
  assert.equal((await restarted.stream(info.id)).url, `${info.url}&request=2`)
  assert.equal(f.resolutions(), 2)
  await restarted.star(`yt:${info.id}`, "track", false)
  assert.equal(restarted.starred().tracks.length, 0)
})

test("simultaneous and repeated playback share a valid URL, and refresh explicitly renews it", async (t) => {
  const f = await fixture(t)
  const streams = await Promise.all([f.music.stream(info.id), f.music.stream(info.id), f.music.stream(info.id)])
  assert.ok(streams.every((stream) => stream.url === streams[0].url))
  assert.equal(f.resolutions(), 1)
  assert.equal((await f.music.stream(info.id)).url, streams[0].url)
  assert.equal(f.resolutions(), 1)
  assert.notEqual((await f.music.stream(info.id, { refresh: true })).url, streams[0].url)
  assert.equal(f.resolutions(), 2)
})

test("direct audio skips HLS and a missing format falls back to full extraction", async (t) => {
  const calls = []
  const f = await fixture(t, async (args) => {
    calls.push(args)
    if (args.includes("youtube:skip=hls")) throw new Error("Requested format is not available. Use --list-formats.")
    return JSON.stringify(info)
  })
  assert.equal((await f.music.stream(info.id)).url, info.url)
  assert.equal(calls.length, 2)
  assert.ok(calls[0].includes("youtube:skip=hls"))
  assert.ok(!calls[1].includes("--extractor-args"))
  await f.music.stream(info.id)
  assert.equal(calls.length, 2)
})

test("refreshing a rejected media URL uses full extraction directly", async (t) => {
  const calls = []
  const f = await fixture(t, async (args) => { calls.push(args); return JSON.stringify(info) })
  await f.music.prepare(info.id)
  await f.music.stream(info.id, { refresh: true })
  assert.equal(calls.length, 2)
  assert.ok(calls[0].includes("youtube:skip=hls"))
  assert.ok(!calls[1].includes("--extractor-args"))
})

test("preparing audio shares resolution with playback but stores no library entry or signed URL", async (t) => {
  const f = await fixture(t)
  await Promise.all([f.music.prepare(info.id), f.music.prepare(`yt:${info.id}`)])
  assert.equal(f.resolutions(), 1)
  assert.deepEqual(await readdir(f.dataDir), [])
  assert.equal(f.music.playlists()[0].tracks.length, 0)
  const stream = await f.music.stream(info.id)
  assert.equal(f.resolutions(), 1)
  assert.ok(stream.url.endsWith("&request=1"))
  assert.equal(f.music.playlists()[0].tracks.length, 1)
  assert.ok(!(await readFile(join(f.dataDir, "library.json"), "utf8")).includes("googlevideo"))
})

test("URL cache lasts at most five minutes and expires a minute before the signed URL", async (t) => {
  let now = Date.now()
  t.mock.method(Date, "now", () => now)
  const f = await fixture(t)
  const first = await f.music.stream(info.id)
  now += 5 * 60_000 - 1
  assert.equal((await f.music.stream(info.id)).url, first.url)
  now += 2
  assert.notEqual((await f.music.stream(info.id)).url, first.url)

  let calls = 0
  const soon = await fixture(t, async () => {
    calls++
    return JSON.stringify({ ...info, url: `https://audio.googlevideo.com/videoplayback?expire=${Math.floor((now + 100_000) / 1000)}&request=${calls}` })
  })
  const signed = await soon.music.stream(info.id)
  now += 20_000
  assert.equal((await soon.music.stream(info.id)).url, signed.url)
  now += 21_000
  assert.notEqual((await soon.music.stream(info.id)).url, signed.url)
})

test("expired URLs and URLs without a known expiry are never reused", async (t) => {
  for (const query of ["", "?expire=1"]) {
    let calls = 0
    const f = await fixture(t, async () => {
      calls++
      return JSON.stringify({ ...info, url: `https://audio.googlevideo.com/videoplayback${query}` })
    })
    await f.music.prepare(info.id)
    await f.music.stream(info.id)
    assert.equal(calls, 2)
  }
})

test("background preparation leaves resolution capacity for foreground playback", async (t) => {
  const pending = []
  const f = await fixture(t, (args) => new Promise((resolve) => pending.push({ id: new URL(args.at(-1)).searchParams.get("v"), resolve })))
  const prepared = f.music.prepare(info.id)
  await assert.rejects(f.music.prepare("aaaaaaaaaaa"), (error) => error.status === 429)
  const playing = f.music.stream("aaaaaaaaaaa")
  const another = f.music.stream("bbbbbbbbbbb")
  await assert.rejects(f.music.stream("ccccccccccc"), (error) => error.status === 429)
  assert.equal(pending.length, 3)
  pending.forEach(({ id, resolve }) => resolve(JSON.stringify({ ...info, id })))
  await Promise.all([prepared, playing, another])
  assert.equal(f.music.playlists()[0].tracks.length, 2)
})

test("failed URL resolution can be retried and creates no audio files", async (t) => {
  let attempts = 0
  const f = await fixture(t, async () => { attempts++; throw new Error("YouTube no disponible") })
  await assert.rejects(f.music.stream(info.id), /YouTube no disponible/)
  await assert.rejects(f.music.stream(info.id), /YouTube no disponible/)
  assert.equal(attempts, 2)
  assert.deepEqual(await readdir(f.dataDir), [])
})

test("HTTP returns the direct URL without caching, validates requests and rejects unrelated origins", async (t) => {
  const f = await fixture(t)
  const app = await createApp({ music: f.music, allowedOrigins: ["http://127.0.0.1:3000"] })
  app.listen(0, "127.0.0.1")
  await once(app, "listening")
  t.after(() => new Promise((resolve) => { app.close(resolve); app.closeAllConnections() }))
  const base = `http://127.0.0.1:${app.address().port}/api/music`
  const response = await fetch(`${base}/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: info.id }) })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal((await response.json()).url, `${info.url}&request=1`)
  const prepared = await fetch(`${base}/prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: info.id }) })
  assert.equal(prepared.status, 200)
  assert.deepEqual(await prepared.json(), { ok: true })
  assert.equal(f.resolutions(), 1)
  const renewed = await fetch(`${base}/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: info.id, refresh: true }) })
  assert.equal((await renewed.json()).url, `${info.url}&request=2`)
  const invalidPreparation = await fetch(`${base}/prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "../../etc/passwd" }) })
  assert.equal(invalidPreparation.status, 400)
  const invalidId = await fetch(`${base}/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "../../etc/passwd" }) })
  assert.equal(invalidId.status, 400)
  assert.equal((await fetch(`${base}/audio/${info.id}`)).status, 404)
  assert.equal((await fetch(`${base}/search?q=test`, { headers: { Origin: "https://unrelated.test" } })).status, 403)
  const preflight = await fetch(`${base}/stream`, { method: "OPTIONS", headers: { Origin: "http://127.0.0.1:3000" } })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://127.0.0.1:3000")
  const invalid = await fetch(`${base}/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })
  assert.equal(invalid.status, 400)
})

test("missing yt-dlp produces an actionable error", async () => {
  await assert.rejects(createYtDlpRunner("/nonexistent-musica-ytdlp")(["--version"]), /npm run music:setup/)
})

test("recommendations use Music radio, preserving order and excluding the seed, duplicates and unplayable videos", async (t) => {
  const entries = [
    song, { ...song, videoId: "aaaaaaaaaaa", title: "Primera" }, null,
    { ...song, videoId: "bbbbbbbbbbb", title: "Segunda" }, { ...song, videoId: "aaaaaaaaaaa" },
    { ...song, videoId: "ccccccccccc", live_status: "is_live" },
    { ...song, videoId: "ddddddddddd", live_status: "is_upcoming" },
    { ...song, videoId: "eeeeeeeeeee", availability: "private" },
    { ...song, videoId: "fffffffffff", is_live: true }, { ...song, videoId: "invalid" },
    { ...song, videoId: "ggggggggggg", isAvailable: false },
  ]
  let calls = 0
  const f = await fixture(t, async () => { throw new Error("Recommendations must not invoke yt-dlp") }, async (operation, id) => {
    calls++
    assert.equal(operation, "recommendations")
    assert.equal(id, info.id)
    return { tracks: entries }
  })
  const [first, simultaneous] = await Promise.all([f.music.recommendations(`yt:${info.id}`), f.music.recommendations(info.id)])
  assert.deepEqual(first.map((track) => track.title), ["Primera", "Segunda"])
  assert.deepEqual(first, simultaneous)
  assert.deepEqual(await f.music.recommendations(info.id), first)
  assert.equal(calls, 1)
  assert.deepEqual(await readdir(f.dataDir), [])
  assert.equal(f.music.playlists()[0].tracks.length, 0)
})

test("recommendations validate identifiers before querying Music and retry failed requests", async (t) => {
  let calls = 0
  const f = await fixture(t, undefined, async () => {
    calls++
    if (calls === 1) throw new Error("YouTube no disponible")
    return { tracks: [song, { ...song, videoId: "aaaaaaaaaaa" }] }
  })
  for (const id of [null, "../../etc/passwd", "https://youtube.com/watch?v=BaW_jenozKc"]) await assert.rejects(f.music.recommendations(id))
  assert.equal(calls, 0)
  await assert.rejects(f.music.recommendations(info.id), /YouTube no disponible/)
  assert.equal((await f.music.recommendations(info.id)).length, 1)
  assert.equal(calls, 2)
})

test("recommendations are exposed over HTTP with input and origin checks", async (t) => {
  const f = await fixture(t, undefined, async () => ({ tracks: [song, { ...song, videoId: "aaaaaaaaaaa" }] }))
  const app = await createApp({ music: f.music })
  app.listen(0, "127.0.0.1")
  await once(app, "listening")
  t.after(() => new Promise((resolve) => { app.close(resolve); app.closeAllConnections() }))
  const base = `http://127.0.0.1:${app.address().port}/api/music/recommendations`
  const response = await fetch(`${base}?id=yt:${info.id}`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal((await response.json())[0].id, "yt:aaaaaaaaaaa")
  assert.equal((await fetch(base)).status, 400)
  assert.equal((await fetch(`${base}?id=${info.id}`, { headers: { Origin: "https://unrelated.test" } })).status, 403)
})

test("text searches and pasted links use the catalogue, refresh favourite status and never invoke yt-dlp", async (t) => {
  const calls = []
  const f = await fixture(t, async () => { throw new Error("Search must not invoke yt-dlp") }, async (operation, value) => {
    calls.push([operation, value])
    return operation === "search" ? [song, song, { ...song, videoId: "invalid" }] : ["searchAlbums", "searchArtists"].includes(operation) ? [] : song
  })
  const first = await f.music.search("  una canción  ")
  assert.equal(first.tracks.length, 1)
  assert.equal(first.tracks[0].album, song.album.name)
  assert.equal(first.tracks[0].metadataSource, "ytmusic")
  await f.music.star(first.tracks[0].id, "track", true)
  assert.equal((await f.music.search("una canción")).tracks[0].starred, true)
  assert.deepEqual(calls, [["search", "una canción"], ["searchAlbums", "una canción"], ["searchArtists", "una canción"]])
  assert.equal((await f.music.search(`https://youtu.be/${info.id}?list=unused`)).tracks[0].id, `yt:${info.id}`)
  assert.deepEqual(calls.at(-1), ["song", info.id])
})

test("album searches deduplicate canonical albums and open every track without importing the album", async (t) => {
  const calls = []
  const albumInfo = { browseId: song.album.id, title: song.album.name, artists: song.artists, thumbnails: song.thumbnails, year: "2008" }
  const f = await fixture(t, async () => { throw new Error("Album searches must not invoke yt-dlp") }, async (operation, value) => {
    calls.push([operation, value])
    if (operation === "search") return [song]
    if (operation === "searchAlbums") return [albumInfo, albumInfo, null, { ...albumInfo, browseId: "../../private" }, { ...albumInfo, title: "" }]
    if (operation === "searchArtists") return []
    if (operation === "album") return { ...albumInfo, tracks: [song, { ...song, title: "Segunda", videoId: "aaaaaaaaaaa" }] }
    throw new Error(`Unexpected operation ${operation}`)
  })
  const albumsOnly = await f.music.search(" un álbum ", "albums")
  assert.deepEqual(calls, [["searchAlbums", "un álbum"]])
  assert.equal(albumsOnly.tracks.length, 0)
  assert.equal(albumsOnly.albums.length, 1)
  const album = albumsOnly.albums[0]
  assert.equal(album.id, `ytm-album:${song.album.id}`)
  assert.equal(album.name, song.album.name)
  assert.equal(album.artist, song.artists[0].name)
  assert.equal(album.year, 2008)
  assert.equal(album.coverArt, song.thumbnails[0].url)
  const all = await f.music.search("un álbum")
  assert.equal(all.albums.length, 1)
  assert.equal(all.tracks.length, 1)
  assert.deepEqual(calls, [["searchAlbums", "un álbum"], ["search", "un álbum"], ["searchArtists", "un álbum"]])
  const songsOnly = await f.music.search("un álbum", "tracks")
  assert.equal(songsOnly.albums.length, 0)
  assert.equal(songsOnly.tracks.length, 1)
  const complete = await f.music.album(album.id)
  assert.deepEqual(complete.tracks.map((track) => track.title), [song.title, "Segunda"])
  assert.equal(complete.songCount, 2)
  assert.equal(complete.duration, 20)
  assert.deepEqual(await readdir(f.dataDir), [])
  assert.equal(f.music.playlists()[0].tracks.length, 0)
  assert.equal(f.resolutions(), 0)
})

test("song suggestions skip album lookups, and invalid filters fail before catalogue access", async (t) => {
  const calls = []
  const f = await fixture(t, undefined, async (operation, value) => { calls.push([operation, value]); return [song] })
  assert.equal((await f.music.search("una canción", "tracks")).tracks.length, 1)
  assert.deepEqual(calls, [["search", "una canción"]])
  await assert.rejects(f.music.search("una canción", "unknown"), { status: 400 })
  assert.equal(calls.length, 1)
})

test("album filtering is exposed over HTTP without losing input validation", async (t) => {
  const f = await fixture(t, undefined, async (operation) => {
    assert.equal(operation, "searchAlbums")
    return [{ browseId: song.album.id, title: song.album.name, artists: song.artists }]
  })
  const app = await createApp({ music: f.music })
  app.listen(0, "127.0.0.1")
  await once(app, "listening")
  t.after(() => new Promise((resolve) => { app.close(resolve); app.closeAllConnections() }))
  const base = `http://127.0.0.1:${app.address().port}/api/music/search`
  const response = await fetch(`${base}?q=un+álbum&type=albums`)
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.albums[0].id, `ytm-album:${song.album.id}`)
  assert.deepEqual(result.tracks, [])
  assert.equal((await fetch(`${base}?q=test&type=invalid`)).status, 400)
  assert.equal((await fetch(`${base}?type=albums`)).status, 400)
})

test("album pages fetch all catalogue tracks and saved songs share one album", async (t) => {
  let offline = false
  const f = await fixture(t, undefined, async (operation, id) => {
    assert.ok(!offline, "Removing a favourite must not query the catalogue")
    assert.equal(operation, "album")
    assert.equal(id, song.album.id)
    return { title: song.album.name, artists: song.artists, year: "2008", thumbnails: song.thumbnails, tracks: [song, { ...song, videoId: "aaaaaaaaaaa", title: "Segunda", duration_seconds: 30 }] }
  })
  const albumId = `ytm-album:${song.album.id}`
  const album = await f.music.album(albumId)
  assert.equal(album.tracks.length, 2)
  assert.equal(album.duration, 40)
  assert.ok(album.tracks.every((track) => track.albumId === albumId && track.year === 2008))
  for (const track of album.tracks) await f.music.star(track.id, "track", true)
  assert.equal(f.music.albums().length, 1)
  assert.equal(f.music.albums()[0].songCount, 2)
  assert.equal(f.music.artists()[0].albumCount, 1)
  await f.music.star(albumId, "album", true)
  assert.equal(f.music.starred().albums[0].id, albumId)
  offline = true
  await f.music.star(albumId, "album", false)
  assert.equal(f.music.starred().albums.length, 0)
})

test("upgrading video metadata preserves track, album and artist favourites and listening history", async (t) => {
  const f = await fixture(t)
  await f.music.stream(info.id)
  await f.music.star(`yt:${info.id}`, "track", true)
  await f.music.star(`yt-album:${info.id}`, "album", true)
  await f.music.star(`yt-artist:${info.uploader}`, "artist", true)
  await f.music.scrobble(info.id, true)
  await f.music.search("una canción")
  await f.music.stream(info.id)
  const restarted = await createMusicService({ dataDir: f.dataDir, run: f.run, catalog: f.catalog })
  assert.equal(restarted.starred().tracks[0].title, song.title)
  assert.equal(restarted.starred().albums[0].id, `ytm-album:${song.album.id}`)
  assert.equal(restarted.starred().artists[0].id, `ytm-artist:${song.artists[0].id}`)
  assert.equal((await restarted.home()).frequent.length, 1)
})

test("missing catalogue Python produces an actionable error", async () => {
  await assert.rejects(createYtMusicRunner("/nonexistent-musica-python", "server/ytmusic.py")("health"), /npm run music:setup/)
})
