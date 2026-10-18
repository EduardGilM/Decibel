import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { promisify } from "node:util"
import { createApp } from "./index.mjs"
import { createProfileApi } from "./profile-api.mjs"
import { createMusicService } from "./ytdlp.mjs"
import { createYtMusicRunner, mapCatalogArtist, mapCatalogTrack } from "./ytmusic.mjs"

const artistId = "UCaaaaaaaaaaaaaaaaaaaaaa", relatedId = "UCbbbbbbbbbbbbbbbbbbbbbb"
const artist = { browseId: artistId, artist: "Artista principal", thumbnails: [{ url: "https://example.com/small.jpg", width: 60 }, { url: "https://example.com/large.jpg", width: 800 }] }
const song = (videoId, extra = {}) => ({ videoId, title: `Tema ${videoId}`, artists: [{ id: artistId, name: artist.artist }], album: { id: "MPREb_aaaaaaaaaaa", name: "Álbum" }, ...extra })

async function fixture(t, catalog, library) {
  const dataDir = await mkdtemp(join(tmpdir(), "decibel-artists-"))
  t.after(() => rm(dataDir, { recursive: true, force: true }))
  if (library) await writeFile(join(dataDir, "library.json"), JSON.stringify(library))
  const music = await createMusicService({ dataDir, catalog, run: () => assert.fail("Artists never need yt-dlp or audio downloads") })
  return { music, dataDir }
}

test("artist and track mapping retain all credits, optional IDs and the existing primary fields", () => {
  const mapped = mapCatalogTrack(song("aaaaaaaaaaa", { artists: [{ name: "Primero sin ID" }, { id: artistId, name: "Segundo" }, { id: relatedId, name: "Tercero" }, { id: "../../private", name: "Crédito sin enlace" }] }))
  assert.equal(mapped.artist, "Primero sin ID, Segundo, Tercero, Crédito sin enlace")
  assert.equal(mapped.artistId, `ytm-artist:${artistId}`)
  assert.deepEqual(mapped.artists, [{ name: "Primero sin ID" }, { id: `ytm-artist:${artistId}`, name: "Segundo" }, { id: `ytm-artist:${relatedId}`, name: "Tercero" }, { name: "Crédito sin enlace" }])
  assert.equal(mapCatalogTrack(song("aaaaaaaaaaa", { artists: undefined, artist: "Texto antiguo" })).artist, "Texto antiguo")
  assert.equal(mapCatalogArtist(artist).coverArt, "https://example.com/large.jpg")
  assert.equal(mapCatalogArtist({ ...artist, artist: undefined, title: "Relacionado" }).name, "Relacionado")
  for (const value of [null, {}, { ...artist, browseId: "../../private" }, { ...artist, artist: " " }]) assert.equal(mapCatalogArtist(value), undefined)
})

test("all search starts three shared searches in parallel; artists are ordered, deduplicated and capped at 8/20", async (t) => {
  const calls = [], releases = []
  const rows = Array.from({ length: 24 }, (_, i) => ({ ...artist, browseId: `UC${String(i).padStart(22, "0")}`, artist: `Artista ${i}` }))
  const { music, dataDir } = await fixture(t, (op, query) => {
    calls.push([op, query])
    return new Promise((done) => releases.push(() => done(op === "search" ? [song("aaaaaaaaaaa")] : op === "searchAlbums" ? [] : [rows[0], rows[0], null, { ...artist, browseId: "bad" }, ...rows.slice(1)])))
  })
  const first = music.search(" ejemplo "), concurrent = music.search("ejemplo")
  await Promise.resolve()
  assert.deepEqual(calls, [["search", "ejemplo"], ["searchAlbums", "ejemplo"], ["searchArtists", "ejemplo"]])
  releases.splice(0).forEach((release) => release())
  const [all, same] = await Promise.all([first, concurrent])
  assert.deepEqual(all, same)
  assert.equal(all.tracks.length, 1)
  assert.deepEqual(all.artists.map((a) => a.name), rows.slice(0, 8).map((a) => a.artist))
  const artists = await music.search("ejemplo", "artists")
  assert.deepEqual(artists.tracks, []); assert.deepEqual(artists.albums, [])
  assert.equal(artists.artists.length, 20)
  assert.equal(calls.length, 3)
  assert.deepEqual(await readdir(dataDir), [])
})

test("artist-only search makes no song/album call and invalid filters/IDs fail before upstream work", async (t) => {
  const calls = []
  const { music } = await fixture(t, async (op, query) => { calls.push([op, query]); return [artist] })
  assert.equal((await music.search("artista", "artists")).artists[0].id, `ytm-artist:${artistId}`)
  assert.deepEqual(calls, [["searchArtists", "artista"]])
  for (const value of [null, "", "../../private", "yt-artist:legacy", "ytm-artist:bad", "https://example.com/"]) await assert.rejects(music.artistRecommendations(value), { status: 400 })
  await assert.rejects(music.search("", "artists"), { status: 400 })
  await assert.rejects(music.search("test", "invalid"), { status: 400 })
  assert.equal(calls.length, 1)
})

test("busy parallel searches reject cleanly, handle outstanding failures and can retry", async (t) => {
  const pending = []
  const { music } = await fixture(t, (op, query) => new Promise((resolve, reject) => pending.push({ op, query, resolve, reject })))
  const first = music.search("existing", "tracks")
  await Promise.resolve()
  await assert.rejects(music.search("new"), { status: 429 })
  await Promise.resolve()
  for (const work of pending.splice(0)) {
    if (work.query === "existing") work.resolve([])
    else work.reject(new Error("outstanding catalogue failure"))
  }
  await first
  await new Promise((done) => setImmediate(done))
  const retry = music.search("new")
  await Promise.resolve()
  pending.splice(0).forEach((work) => work.resolve([]))
  assert.deepEqual(await retry, { tracks: [], albums: [], artists: [] })
})

test("artist recommendations prioritise the full song list, accept credited feats and exclude other artists, top songs and duplicates", async (t) => {
  const calls = []
  const info = { name: artist.artist, songs: { browseId: "VLPL_fixture_artist_songs", results: [song("aaaaaaaaaaa"), song("bbbbbbbbbbb")] }, radioId: "RDEM_fixture_radio", shuffleId: "RDAO_fixture_shuffle", related: { results: [artist, { browseId: relatedId, title: "Artista similar", thumbnails: artist.thumbnails }, { browseId: relatedId, title: "Duplicado" }, null, { title: "Sin ID" }] } }
  const radios = [song("aaaaaaaaaaa"), song("ccccccccccc"), song("ccccccccccc"), song("bbbbbbbbbbb"), song("bad"), song("ddddddddddd", { isAvailable: false }), song("eeeeeeeeeee", { is_live: true }), song("fffffffffff", { availability: "premium_only" }), song("iiiiiiiiiii", { artists: [{ id: relatedId, name: artist.artist }] }), song("jjjjjjjjjjj", { artists: [{ name: artist.artist }] }), song("ggggggggggg", { artists: [{ id: relatedId, name: "Primero" }, { id: artistId, name: "Invitado" }] })]
  const { music, dataDir } = await fixture(t, async (op, value) => {
    calls.push([op, value])
    if (op === "artist") return info
    if (op === "artistSongs") {
      assert.equal(value, info.songs.browseId)
      return { tracks: [song("aaaaaaaaaaa"), song("hhhhhhhhhhh"), song("ccccccccccc"), song("hhhhhhhhhhh"), song("kkkkkkkkkkk", { artists: undefined })] }
    }
    assert.equal(op, "artistRadio"); assert.equal(value, info.radioId)
    return { tracks: radios }
  })
  const [page, radio, simultaneous] = await Promise.all([music.artist(`ytm-artist:${artistId}`), music.artistRecommendations(`ytm-artist:${artistId}`), music.artistRecommendations(`ytm-artist:${artistId}`)])
  assert.deepEqual(radio, simultaneous)
  assert.deepEqual(page.topTracks.map((t) => t.id), ["yt:aaaaaaaaaaa", "yt:bbbbbbbbbbb"])
  assert.deepEqual(radio.tracks.map((t) => t.id), ["yt:hhhhhhhhhhh", "yt:ccccccccccc", "yt:ggggggggggg"])
  assert.equal(radio.tracks[2].artists[1].id, `ytm-artist:${artistId}`)
  assert.deepEqual(radio.deepCuts, [])
  assert.deepEqual(radio.artists, [{ id: `ytm-artist:${relatedId}`, name: "Artista similar", coverArt: "https://example.com/large.jpg", starred: false }])
  await music.artistRecommendations(`ytm-artist:${artistId}`)
  assert.deepEqual(calls, [["artist", artistId], ["artistSongs", info.songs.browseId], ["artistRadio", info.radioId]])
  assert.deepEqual(await readdir(dataDir), [])
})

test("artist radio caps tracks at 40, falls back to shuffle, handles absent fields and expires after 30 minutes", async (t) => {
  let now = 1_000_000, calls = 0
  t.mock.method(Date, "now", () => now)
  const { music } = await fixture(t, async (op, value) => {
    calls++
    if (op === "artist") return { shuffleId: "RDAO_fixture_shuffle" }
    assert.equal(op, "artistRadio"); assert.equal(value, "RDAO_fixture_shuffle")
    return { tracks: Array.from({ length: 50 }, (_, i) => song(String(i).padStart(11, "0"))) }
  })
  assert.equal((await music.artistRecommendations(`ytm-artist:${artistId}`)).tracks.length, 40)
  assert.deepEqual((await music.artistRecommendations(`ytm-artist:${artistId}`)).artists, [])
  assert.equal(calls, 2)
  now += 30 * 60_000
  await music.artistRecommendations(`ytm-artist:${artistId}`)
  assert.equal(calls, 4)
  const absent = await fixture(t, async (op) => { assert.equal(op, "artist"); return {} })
  assert.deepEqual(await absent.music.artistRecommendations(`ytm-artist:${artistId}`), { tracks: [], deepCuts: [], artists: [] })
})

test("deep cuts use up to three albums and three singles, preserve credits/metadata and never repeat top songs or tracks", async (t) => {
  const releases = Array.from({ length: 8 }, (_, i) => `MPREb_fixture_${i}`)
  const calls = [], visited = []
  let active = 0, peak = 0
  const info = { songs: { browseId: "VLPL_fixture_artist_songs", results: [song("aaaaaaaaaaa")] }, radioId: "RDEM_fixture_radio", albums: { results: releases.slice(0, 4).map((browseId) => ({ browseId })) }, singles: { results: releases.slice(4).map((browseId) => ({ browseId })) } }
  const { music, dataDir } = await fixture(t, async (op, value) => {
    calls.push([op, value])
    active++; peak = Math.max(peak, active)
    await new Promise((done) => setImmediate(done))
    active--
    if (op === "artist") return info
    if (op === "artistSongs") return { tracks: [song("aaaaaaaaaaa"), song("bbbbbbbbbbb")] }
    if (op === "artistRadio") return { tracks: [song("bbbbbbbbbbb"), song("ccccccccccc")] }
    assert.equal(op, "album"); visited.push(value)
    return { title: `Release ${value}`, artists: [{ id: artistId, name: artist.artist }], year: "2025", thumbnails: artist.thumbnails, tracks: [song("aaaaaaaaaaa"), song("bbbbbbbbbbb"), song("ccccccccccc"), song("ddddddddddd", { artists: [{ id: relatedId, name: "Otro" }] }), song("eeeeeeeeeee", { artists: [] }), song("fffffffffff", { isAvailable: false }), song("ggggggggggg", { artists: undefined, thumbnails: undefined }), ...Array.from({ length: 20 }, (_, i) => song(String(i).padStart(11, "0")))] }
  })
  const [recs, simultaneous] = await Promise.all([music.artistRecommendations(`ytm-artist:${artistId}`), music.artistRecommendations(`ytm-artist:${artistId}`)])
  assert.deepEqual(recs, simultaneous)
  assert.deepEqual(recs.tracks.map((t) => t.id), ["yt:bbbbbbbbbbb", "yt:ccccccccccc"])
  assert.equal(recs.deepCuts.length, 15)
  assert.deepEqual(visited, [releases[0], releases[1], releases[2], releases[4], releases[5], releases[6]])
  assert.ok(peak <= 3)
  assert.equal(calls.length, 9)
  assert.equal(new Set(recs.deepCuts.map((t) => t.id)).size, 15)
  for (const track of recs.deepCuts) {
    assert.ok(!["yt:aaaaaaaaaaa", "yt:bbbbbbbbbbb", "yt:ccccccccccc"].includes(track.id))
    assert.ok(track.artists.some((a) => a.id === `ytm-artist:${artistId}`))
    assert.equal(track.albumId, `ytm-album:${releases[0]}`)
    assert.equal(track.album, `Release ${releases[0]}`)
    assert.equal(track.coverArt, "https://example.com/large.jpg")
    assert.equal(track.year, 2025)
  }
  await music.artistRecommendations(`ytm-artist:${artistId}`)
  assert.equal(calls.length, 9)
  assert.deepEqual(await readdir(dataDir), [])
})

test("the first forty songs keep playlist order before radio; remaining album songs can be deep cuts", async (t) => {
  const rows = Array.from({ length: 45 }, (_, i) => song(String(i).padStart(11, "0")))
  const { music } = await fixture(t, async (op) => {
    if (op === "artist") return { songs: { browseId: "VLPL_fixture_artist_songs" }, radioId: "RDEM_fixture_radio", albums: { results: [{ browseId: "MPREb_fixture_album" }] } }
    if (op === "artistSongs") return { tracks: rows }
    if (op === "artistRadio") return { tracks: [song("aaaaaaaaaaa")] }
    return { title: "Album", tracks: rows }
  })
  const recs = await music.artistRecommendations(`ytm-artist:${artistId}`)
  assert.deepEqual(recs.tracks.map((t) => t.id), rows.slice(0, 40).map((t) => `yt:${t.videoId}`))
  assert.deepEqual(recs.deepCuts.map((t) => t.id), rows.slice(40).map((t) => `yt:${t.videoId}`))
})

test("failed song lists and albums preserve available radio/deep cuts and retry only the failed sources", async (t) => {
  const calls = []
  let unavailable = true
  const { music } = await fixture(t, async (op, value) => {
    calls.push([op, value])
    if (op === "artist") return { songs: { browseId: "VLPL_fixture_artist_songs" }, radioId: "RDEM_fixture_radio", albums: { results: [{ browseId: "MPREb_fixture_failed" }, { browseId: "MPREb_fixture_valid" }] } }
    if (unavailable && (op === "artistSongs" || value === "MPREb_fixture_failed")) throw new Error("fixture outage")
    if (op === "artistSongs") return { tracks: [song("aaaaaaaaaaa")] }
    if (op === "artistRadio") return { tracks: [song("bbbbbbbbbbb")] }
    return { tracks: [song(value === "MPREb_fixture_failed" ? "ccccccccccc" : "ddddddddddd")] }
  })
  const first = await music.artistRecommendations(`ytm-artist:${artistId}`)
  assert.deepEqual(first.tracks.map(t => t.id), ["yt:bbbbbbbbbbb"])
  assert.deepEqual(first.deepCuts.map(t => t.id), ["yt:ddddddddddd"])
  unavailable = false
  const next = await music.artistRecommendations(`ytm-artist:${artistId}`)
  assert.deepEqual(next.tracks.map(t => t.id), ["yt:aaaaaaaaaaa", "yt:bbbbbbbbbbb"])
  assert.deepEqual(next.deepCuts.map(t => t.id), ["yt:ccccccccccc", "yt:ddddddddddd"])
  assert.deepEqual(calls.slice(5), [["artistSongs", "VLPL_fixture_artist_songs"], ["album", "MPREb_fixture_failed"]])
})

test("recommendation source IDs from the catalogue are validated; URLs/paths never reach the bridge", async (t) => {
  const calls = []
  const { music } = await fixture(t, async (op) => {
    calls.push(op)
    return { songs: { browseId: "https://example.com/private" }, radioId: "../../secret", albums: { results: [{ browseId: "https://example.com/album" }, null] }, singles: { results: [{ browseId: "file:///private" }] } }
  })
  assert.deepEqual(await music.artistRecommendations(`ytm-artist:${artistId}`), { tracks: [], deepCuts: [], artists: [] })
  assert.deepEqual(calls, ["artist"])
})

test("a failed artist radio is retried instead of cached as an empty successful response", async (t) => {
  let calls = 0
  const { music } = await fixture(t, async (op) => {
    if (op === "artist") return { radioId: "RDEM_fixture_radio" }
    if (++calls === 1) throw new Error("fixture outage")
    return { tracks: [song("aaaaaaaaaaa")] }
  })
  assert.deepEqual(await music.artistRecommendations(`ytm-artist:${artistId}`), { tracks: [], deepCuts: [], artists: [] })
  assert.equal((await music.artistRecommendations(`ytm-artist:${artistId}`)).tracks.length, 1)
  assert.equal(calls, 2)
})

test("saved canonical metadata without credits cannot replace verified recommendation credits", async (t) => {
  const saved = { ...mapCatalogTrack(song("aaaaaaaaaaa")), artist: "Créditos antiguos", artists: undefined }
  const library = { tracks: { "yt:aaaaaaaaaaa": { track: saved } }, likes: { track: ["yt:aaaaaaaaaaa"], album: [], artist: [] } }
  const { music, dataDir } = await fixture(t, async (op) => op === "artist" ? { radioId: "RDEM_fixture_radio" } : { tracks: [song("aaaaaaaaaaa", { album: undefined, artists: [{ id: relatedId, name: "Primero" }, { id: artistId, name: "Invitado" }] })] }, library)
  const recs = await music.artistRecommendations(`ytm-artist:${artistId}`)
  assert.equal(recs.tracks[0].starred, true)
  assert.equal(recs.tracks[0].artist, "Primero, Invitado")
  assert.equal(recs.tracks[0].artists[1].id, `ytm-artist:${artistId}`)
  assert.equal(await readFile(join(dataDir, "library.json"), "utf8"), JSON.stringify(library))
})

test("artist APIs require cookie/Bearer sessions and keep request validation and native CORS", async (t) => {
  const { music } = await fixture(t, async (op) => op === "searchArtists" ? [artist] : { related: { results: [artist] } })
  const profiles = await createProfileApi({ seed: false })
  const user = await profiles.accounts.createUser({ username: "Music Fixture", password: "fixture-password" }), token = profiles.accounts.createSession(user.id)
  const app = await createApp({ music, profiles, allowedOrigins: ["https://tauri.localhost"] })
  app.listen(0, "127.0.0.1"); await once(app, "listening")
  t.after(async () => { await new Promise((done) => { app.close(done); app.closeAllConnections() }); profiles.db.close() })
  const base = `http://127.0.0.1:${app.address().port}/api/music`
  for (const path of ["/search?q=example&type=artists", `/artist-recommendations?id=ytm-artist:${artistId}`]) {
    assert.equal((await fetch(base + path)).status, 401)
    const bearer = await fetch(base + path, { headers: { Authorization: `Bearer ${token}`, Origin: "https://tauri.localhost" } })
    assert.equal(bearer.status, 200)
    const cookie = await fetch(base + path, { headers: { Cookie: `decibel_session=${token}` } })
    assert.deepEqual(await cookie.json(), await bearer.json())
    assert.equal((await fetch(base + path, { headers: { Authorization: `Bearer ${token}`, Origin: "https://foreign.example" } })).status, 403)
  }
  assert.equal((await fetch(base + "/artist-recommendations?id=bad", { headers: { Authorization: `Bearer ${token}` } })).status, 400)
})

test("the Python bridge registers artistSongs with a hard limit of 100 and only accepts catalogue IDs", async (t) => {
  const { dataDir } = await fixture(t)
  const script = join(dataDir, "fake_catalog.py"), bridge = fileURLToPath(new URL("./ytmusic.py", import.meta.url))
  await writeFile(script, `import runpy, sys, types
class Session:
    def __enter__(self): return self
    def __exit__(self, *args): pass
class Music:
    def __init__(self, **kwargs): pass
    def search(self, value, **kwargs): return [{"query": value, **kwargs} for _ in range(24)]
    def get_watch_playlist(self, **kwargs): return {"request": kwargs, "tracks": []}
    def get_playlist(self, value, **kwargs): return {"tracks": [{"playlistId": value, **kwargs} for _ in range(105)]}
sys.modules['requests'] = types.SimpleNamespace(Session=Session)
sys.modules['ytmusicapi'] = types.SimpleNamespace(YTMusic=Music)
runpy.run_path(${JSON.stringify(bridge)}, run_name='__main__')
`)
  const catalog = createYtMusicRunner("python3", script)
  const artists = await catalog("searchArtists", "Example Artist")
  assert.equal(artists.length, 20)
  assert.deepEqual(artists[0], { query: "Example Artist", filter: "artists", limit: 20 })
  const radio = await catalog("artistRadio", "RDEM_fixture_radio")
  assert.deepEqual(radio.request, { playlistId: "RDEM_fixture_radio", limit: 50 })
  assert.deepEqual(radio.tracks, [])
  const songs = await catalog("artistSongs", "VLPL_fixture_artist_songs")
  assert.equal(songs.tracks.length, 100)
  assert.deepEqual(songs.tracks[0], { playlistId: "VLPL_fixture_artist_songs", limit: 100 })
  for (const value of [null, "", "../../private", "https://example.com/private", "file:///private", "bad"]) await assert.rejects(catalog("artistSongs", value), { status: 400 })
  await assert.rejects(promisify(execFile)("python3", ["-B", script, "artistSongs", "https://example.com/private"]), (error) => {
    assert.equal(error.code, 1)
    assert.deepEqual(JSON.parse(error.stderr), { error: "catalogue" })
    assert.equal(error.stdout, "")
    return true
  })
  assert.ok((await readFile(script)).length)
})
