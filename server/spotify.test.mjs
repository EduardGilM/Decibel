import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { test } from "node:test"
import { deflateRawSync } from "node:zlib"
import { openDb } from "./db.mjs"
import { createApp } from "./index.mjs"
import { createProfileApi } from "./profile-api.mjs"
import { createSpotifyImport, matchTrack, parseLibraryFile } from "./spotify.mjs"
import { readSpotifyPlaylist, spotifyPlaylistLink } from "./spotify-playlist.mjs"

/** Minimal deflated ZIP (what JSZip writes for Exportify's «Exportar todo»). */
function zip(files) {
  const parts = [], directory = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const file = Buffer.from(name), raw = Buffer.from(text), data = deflateRawSync(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(file.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(file.length, 28); central.writeUInt32LE(offset, 42)
    parts.push(local, file, data); directory.push(central, file)
    offset += 30 + file.length + data.length
  }
  const listing = Buffer.concat(directory), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(directory.length / 2, 8); end.writeUInt16LE(directory.length / 2, 10); end.writeUInt32LE(listing.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, listing, end])
}

// exportify.app CSV: translated headers (here Spanish), fixed column order, "\," inside an artist name.
const sid = (n) => String(n).padStart(22, "0")
const EXPORTIFY_HEADER = ["URI de la canción", "Nombre de la canción", "URI(s) del artista", "Nombre(s) del artista", "URI del álbum", "Nombre del álbum", "URI(s) del artista del álbum", "Nombre(s) del artista del álbum", "Fecha de lanzamiento del álbum", "URL de la imagen del álbum", "Número de disco", "Número de la canción", "Duración de la canción (ms)", "URL de vista previa de la canción", "Explícito", "Popularidad", "ISRC", "Añadido por", "Añadido en"]
const exportifyRow = (n, name, artists, seconds, added = "") => [`spotify:track:${sid(n)}`, name, artists.map(() => `spotify:artist:${sid(9)}`).join(", "), artists.map((a) => a.replace(/,/g, "\\,")).join(", "), `spotify:album:${sid(8)}`, "Álbum", "", "", "2020", "", "1", "1", String(seconds * 1000), "", "false", "50", "ES0000000000", "", added]
const csv = (rows) => [EXPORTIFY_HEADER, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n"
const exportifyZip = () => zip({
  "liked.csv": csv([exportifyRow(3, "Otra (feat. Invitada)", ["Artista"], 150, "2026-01-02T00:00:00Z"), exportifyRow(1, "Canción - Remastered 2011", ["Artista"], 200, "2026-01-01T00:00:00Z")]),
  "viaje.csv": csv([exportifyRow(1, "Canción - Remastered 2011", ["Artista"], 200), exportifyRow(2, "Versión", ["Artista"], 180)]),
})

const API = "https://api.spotify.test/v1"
const ACCOUNTS = "https://accounts.spotify.test"
const CLIENT = "0123456789abcdef0123456789abcdef"
const yt = (id, title, artist, duration) => ({ id: `yt:${id}`, title, artist, artists: [{ name: artist }], album: "Álbum", duration, metadataSource: "ytmusic", starred: false })
const sp = (id, name, artist, seconds, type = "track") => ({ type, id, name, artists: [{ name: artist }], duration_ms: seconds * 1000 })

// Disposable Spotify account: an own playlist, a collaborative one whose items Spotify refuses (403) and a
// followed one that must not be read, plus two liked songs.
function spotifyAccount({ meStatus = 200, rateLimitOnce = false } = {}) {
  const calls = []
  let limited = !rateLimitOnce
  const routes = {
    "/me": { id: "sp-user" },
    "/me/playlists?limit=50": { items: [{ id: "own", name: "Viaje", owner: { id: "sp-user" } }, { id: "collab", name: "Familia", owner: { id: "sp-other" }, collaborative: true }, { id: "followed", name: "Éxitos", owner: { id: "spotify" } }], next: `${API}/me/playlists?offset=50&limit=50` },
    "/me/playlists?offset=50&limit=50": { items: [], next: null },
    "/playlists/own/items?limit=50&additional_types=track": { items: [{ item: sp("s1", "Canción - Remastered 2011", "Artista", 200) }, { item: sp("s2", "Versión", "Artista", 180) }, { item: sp("e1", "Episodio", "Podcast", 1800, "episode") }], next: null },
    "/me/tracks?limit=50": { items: [{ added_at: "2026-01-02T00:00:00Z", track: sp("s3", "Otra (feat. Invitada)", "Artista", 150) }, { added_at: "2026-01-01T00:00:00Z", track: sp("s1", "Canción - Remastered 2011", "Artista", 200) }], next: null },
  }
  const fetch = async (url, init = {}) => {
    url = String(url)
    calls.push({ url, init })
    if (url === `${ACCOUNTS}/api/token`) {
      return new URLSearchParams(init.body).get("code") === "good-code" ? Response.json({ access_token: "token", token_type: "Bearer", expires_in: 3600 }) : Response.json({ error: "invalid_grant" }, { status: 400 })
    }
    if (init.headers?.Authorization !== "Bearer token") return Response.json({}, { status: 401 })
    const path = url.slice(API.length)
    if (path === "/me" && meStatus !== 200) return Response.json({}, { status: meStatus })
    if (path === "/me/tracks?limit=50" && !limited) { limited = true; return new Response("{}", { status: 429, headers: { "Retry-After": "1" } }) }
    if (path.startsWith("/playlists/collab/")) return Response.json({}, { status: 403 })
    return routes[path] ? Response.json(routes[path]) : Response.json({}, { status: 404 })
  }
  return { fetch, calls }
}

const catalog = {
  "Canción Artista": [yt("cover", "Canción", "Otro Grupo", 200), yt("live", "Canción (Live)", "Artista", 260), yt("s1", "Canción (Remastered 2011)", "Artista", 201)],
  "Versión Artista": [yt("other", "Versión", "Otro", 180)],
  "Otra Artista": [yt("s3", "Otra", "Artista", 151)],
}

async function setup(t, options = {}) {
  const profiles = await createProfileApi({ db: openDb(":memory:"), seed: false })
  await profiles.accounts.createUser({ username: "Prueba Admin", password: "clave-admin", role: "admin" })
  await profiles.accounts.createUser({ username: "Prueba A", password: "clave-a" })
  await profiles.accounts.createUser({ username: "Prueba B", password: "clave-b" })
  const account = spotifyAccount(options)
  const searches = []
  const clock = { now: Date.now() }
  const spotify = createSpotifyImport({
    db: profiles.db, library: profiles.library, fetch: options.fetch ?? account.fetch, accounts: ACCOUNTS, api: API, now: () => clock.now, wait: async () => {}, allowedOrigins: ["tauri://localhost"],
    search: async (query) => { searches.push(query); return { tracks: catalog[query] ?? [], albums: [], artists: [] } },
  })
  const app = await createApp({ music: {}, profiles, spotify })
  app.listen(0, "127.0.0.1")
  await once(app, "listening")
  t.after(() => new Promise((resolve) => { app.close(resolve); app.closeAllConnections() }))
  const base = `http://127.0.0.1:${app.address().port}`
  const call = async (path, { token, method = "GET", body, raw } = {}) => {
    const type = raw ? { "Content-Type": "application/zip" } : body ? { "Content-Type": "application/json" } : {}
    const response = await fetch(base + path, { method, headers: { ...type, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: raw ?? (body ? JSON.stringify(body) : undefined) })
    const text = await response.text()
    return { status: response.status, headers: response.headers, body: response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : text }
  }
  const login = async (username, password) => (await call("/api/auth/login", { method: "POST", body: { username, password } })).body.token
  const tokens = { admin: await login("Prueba Admin", "clave-admin"), a: await login("Prueba A", "clave-a"), b: await login("Prueba B", "clave-b") }
  const connect = async (token, body = { base }) => new URL((await call("/api/spotify/connect", { token, method: "POST", body })).body.url).searchParams
  const finished = async (token, path = "/api/spotify") => {
    for (let i = 0; i < 400; i++) {
      const { job } = (await call(path, { token })).body
      if (job && !["connecting", "reading", "matching", "saving"].includes(job.status)) return job
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error("The import did not finish")
  }
  if (!options.unconfigured) await call("/api/spotify/config", { token: tokens.admin, method: "PUT", body: { clientId: CLIENT } })
  return { call, tokens, account, searches, clock, base, connect, finished }
}

test("matching keeps the same recording and rejects covers, live takes and other lengths", () => {
  const wanted = { title: "Canción - Remastered 2011", artists: ["Artista"], duration: 200 }
  assert.equal(matchTrack(wanted, catalog["Canción Artista"])?.id, "yt:s1")
  assert.equal(matchTrack({ title: "Song (feat. Guest)", artists: ["Main", "Guest"], duration: 180 }, [yt("a", "Song", "Main", 183)])?.id, "yt:a")
  assert.equal(matchTrack({ title: "Song", artists: ["Main"], duration: 180 }, [yt("a", "Song", "Main", 200)]), undefined)
  assert.equal(matchTrack({ title: "Malamente", artists: ["Rosalía"], duration: 150 }, [yt("r", "MALAMENTE", "ROSALÍA", 149)])?.id, "yt:r")
  assert.equal(matchTrack({ title: "Song", artists: ["B"], duration: 100 }, [{ id: "yt:z", title: "Song", artist: "A, B", duration: 101 }])?.id, "yt:z")
  // A loose title match (one contains the other) needs an almost identical length.
  assert.equal(matchTrack({ title: "Bohemian Rhapsody", artists: ["Queen"], duration: 354 }, [yt("q", "Bohemian Rhapsody Remastered", "Queen", 360)]), undefined)
})

test("Spotify import: configured once by the admin, matched in the background, saved only to the profile that started it", async (t) => {
  const { call, tokens, account, searches, base, connect, finished } = await setup(t)
  assert.equal((await call("/api/spotify/config", { token: tokens.a, method: "PUT", body: { clientId: CLIENT } })).status, 403)
  assert.equal((await call("/api/spotify/config", { token: tokens.admin, method: "PUT", body: { clientId: "nope" } })).status, 400)
  assert.deepEqual((await call("/api/spotify", { token: tokens.a })).body, { configured: true, job: null })

  const params = await connect(tokens.a, { base, returnTo: base })
  assert.equal(params.get("client_id"), CLIENT)
  assert.equal(params.get("redirect_uri"), `${base}/api/spotify/callback`)
  assert.equal(params.get("code_challenge_method"), "S256")
  assert.equal(params.get("scope"), "playlist-read-private playlist-read-collaborative user-library-read")

  const page = await call(`/api/spotify/callback?code=good-code&state=${params.get("state")}`)
  assert.equal(page.status, 200)
  assert.ok(page.body.includes(`url=${base}/?spotify=1`))
  assert.match(page.headers.get("content-security-policy"), /default-src 'none'/)
  const exchange = new URLSearchParams(account.calls.find((c) => c.url === `${ACCOUNTS}/api/token`).init.body)
  assert.equal(createHash("sha256").update(exchange.get("code_verifier")).digest("base64url"), params.get("code_challenge"))
  assert.equal(exchange.get("redirect_uri"), params.get("redirect_uri"))
  assert.equal(exchange.get("client_id"), CLIENT)

  const job = await finished(tokens.a)
  assert.equal(job.status, "done")
  assert.deepEqual(job.result, { playlists: 1, likes: 2, missing: 1 })
  assert.equal(job.total, 3)
  assert.deepEqual(searches.toSorted(), ["Canción Artista", "Otra Artista", "Versión Artista"])
  assert.ok(!account.calls.some((c) => c.url.includes("/playlists/followed/")))

  const lists = (await call("/api/playlists?source=ytdlp", { token: tokens.a })).body
  assert.deepEqual(lists.map((l) => [l.name, l.songCount]), [["Viaje", 1]])
  const viaje = (await call(`/api/playlists/${lists[0].id}`, { token: tokens.a })).body
  assert.deepEqual(viaje.tracks.map((track) => [track.id, track.starred]), [["yt:s1", undefined]])
  // Spotify's order: most recently liked first.
  assert.deepEqual((await call("/api/me/likes?source=ytdlp", { token: tokens.a })).body.tracks.map((track) => track.id), ["yt:s3", "yt:s1"])

  assert.equal((await call("/api/spotify", { token: tokens.b })).body.job, null)
  assert.equal((await call("/api/playlists?source=ytdlp", { token: tokens.b })).body.length, 0)
  assert.equal((await call("/api/me/likes?source=ytdlp", { token: tokens.b })).body.tracks.length, 0)
  assert.equal((await call(`/api/playlists/${lists[0].id}`, { token: tokens.b })).status, 404)

  // The state works once.
  assert.match((await call(`/api/spotify/callback?code=good-code&state=${params.get("state")}`)).body, /caducado/)

  // Again without a way back (Android: system browser): cached matches, no duplicated list.
  const again = await connect(tokens.a)
  assert.equal((await call("/api/spotify", { token: tokens.a })).body.job, null)
  const androidPage = await call(`/api/spotify/callback?code=good-code&state=${again.get("state")}`)
  assert.match(androidPage.body, /Vuelve a Decibel/)
  assert.doesNotMatch(androidPage.body, /http-equiv|href=/)
  assert.deepEqual((await finished(tokens.a)).result, { playlists: 0, likes: 2, missing: 1 })
  assert.equal(searches.length, 3)
  assert.equal((await call("/api/playlists?source=ytdlp", { token: tokens.a })).body.length, 1)
})

test("Spotify callback rejects forged, reused and expired states and only returns to known origins", async (t) => {
  const { call, tokens, clock, base, connect, finished } = await setup(t)
  assert.equal((await call("/api/spotify/callback?code=good-code&state=forged")).status, 200)
  assert.equal((await call("/api/spotify", { token: tokens.a })).body.job, null)
  assert.equal((await call("/api/spotify/connect", { token: tokens.a, method: "POST", body: { base: "javascript:alert(1)" } })).status, 400)

  let state = (await connect(tokens.a, { base, returnTo: "https://evil.example" })).get("state")
  const cancelled = await call(`/api/spotify/callback?error=access_denied&state=${state}`)
  assert.doesNotMatch(cancelled.body, /evil|href=/)
  assert.deepEqual(await finished(tokens.a), { status: "error", done: 0, total: 0, error: "Has cancelado la conexión con Spotify." })

  state = (await connect(tokens.a, { base, returnTo: "tauri://localhost" })).get("state")
  assert.ok((await call(`/api/spotify/callback?code=bad-code&state=${state}`)).body.includes('href="tauri://localhost/?spotify=1"'))
  assert.match((await finished(tokens.a)).error, /no ha aceptado/)

  state = (await connect(tokens.a)).get("state")
  clock.now += 16 * 60_000
  assert.match((await call(`/api/spotify/callback?code=good-code&state=${state}`)).body, /caducado/)
  assert.equal((await call("/api/spotify", { token: tokens.a })).body.job, null)

  // A newer start replaces the previous link of the same profile.
  const first = (await connect(tokens.a)).get("state")
  await connect(tokens.a)
  assert.match((await call(`/api/spotify/callback?code=good-code&state=${first}`)).body, /caducado/)
})

test("files: Exportify ZIP (translated headers), Spotify's data download and one CSV with every list", () => {
  const exportify = parseLibraryFile(zip({ "liked.csv": csv([exportifyRow(4, "See You Again", ["Tyler, The Creator", "Kali Uchis"], 180, "2026-03-01T10:00:00Z")]), "mi_lista (1).csv": csv([exportifyRow(5, "Uno", ["A"], 100)]), "notas.txt": "x" }))
  assert.deepEqual(exportify.liked.map((l) => [l.wanted.key, l.wanted.artists, l.wanted.duration, l.at]), [[`spotify:${sid(4)}`, ["Tyler, The Creator", "Kali Uchis"], 180, Date.parse("2026-03-01T10:00:00Z")]])
  assert.deepEqual(exportify.playlists.map((p) => [p.name, p.tracks.map((w) => w.title)]), [["Mi lista (1)", ["Uno"]]])

  const download = parseLibraryFile(zip({
    "Spotify Account Data/YourLibrary.json": JSON.stringify({ tracks: [{ artist: "Artista", album: "Álbum", track: "Canción", uri: `spotify:track:${sid(1)}` }] }),
    "Spotify Account Data/Playlist1.json": JSON.stringify({ playlists: [{ name: "Viaje", items: [{ track: { trackName: "Versión", artistName: "Artista", trackUri: `spotify:track:${sid(2)}` } }, { episode: { episodeName: "Podcast" } }] }] }),
  }))
  assert.deepEqual(download.liked.map((l) => l.wanted.key), [`spotify:${sid(1)}`])
  assert.deepEqual(download.playlists.map((p) => [p.name, p.tracks.map((w) => w.title)]), [["Viaje", ["Versión"]]])

  const single = parseLibraryFile(Buffer.from('\uFEFFTrack name,Artist name,Playlist name\n"Hola, adiós",B,Viaje\nOtra,C,Liked Songs\n'), "tunemymusic.csv")
  assert.deepEqual(single.playlists.map((p) => [p.name, p.tracks.map((w) => w.title)]), [["Viaje", ["Hola, adiós"]]])
  assert.deepEqual(single.liked.map((l) => l.wanted.title), ["Otra"])

  assert.throws(() => parseLibraryFile(Buffer.from("nada útil"), "x.csv"), /Exportify/)
  assert.throws(() => parseLibraryFile(Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(40)])), /dañado/)
})

test("an uploaded Exportify ZIP is matched in the background and saved only to the profile that sent it", async (t) => {
  const { call, tokens, searches, finished } = await setup(t)
  assert.equal((await call("/api/spotify/file?name=spotify_playlists.zip", { method: "POST", raw: exportifyZip() })).status, 401)
  assert.equal((await call("/api/spotify/file?name=x.zip", { token: tokens.a, method: "POST", raw: Buffer.from("PK\x03\x04roto") })).status, 400)
  const started = await call("/api/spotify/file?name=spotify_playlists.zip", { token: tokens.a, method: "POST", raw: exportifyZip() })
  assert.equal(started.status, 200)
  const job = await finished(tokens.a)
  assert.equal(job.status, "done")
  assert.deepEqual(job.result, { playlists: 1, likes: 2, missing: 1 })
  assert.deepEqual(searches.toSorted(), ["Canción Artista", "Otra Artista", "Versión Artista"])
  const lists = (await call("/api/playlists?source=ytdlp", { token: tokens.a })).body
  assert.deepEqual(lists.map((l) => [l.name, l.songCount]), [["Viaje", 1]])
  assert.deepEqual((await call("/api/me/likes?source=ytdlp", { token: tokens.a })).body.tracks.map((track) => track.id), ["yt:s3", "yt:s1"])
  assert.equal((await call("/api/playlists?source=ytdlp", { token: tokens.b })).body.length, 0)
  assert.equal((await call("/api/spotify", { token: tokens.b })).body.job, null)
})

test("Spotify import reports unregistered accounts and waits out rate limits", async (t) => {
  const blocked = await setup(t, { meStatus: 403 })
  await blocked.call(`/api/spotify/callback?code=good-code&state=${(await blocked.connect(blocked.tokens.a)).get("state")}`)
  assert.match((await blocked.finished(blocked.tokens.a)).error, /administrador debe añadirla/)
  assert.equal((await blocked.call("/api/playlists?source=ytdlp", { token: blocked.tokens.a })).body.length, 0)

  const limited = await setup(t, { rateLimitOnce: true })
  await limited.call(`/api/spotify/callback?code=good-code&state=${(await limited.connect(limited.tokens.a)).get("state")}`)
  assert.equal((await limited.finished(limited.tokens.a)).status, "done")
  assert.equal(limited.account.calls.filter((c) => c.url === `${API}/me/tracks?limit=50`).length, 2)
})

const PUBLIC_ID = sid(999)
const PUBLIC_URL = `https://open.spotify.com/playlist/${PUBLIC_ID}`
const PUBLIC_TRACKS = [sp(sid(3), "Otra (feat. Invitada)", "Artista", 150), sp(sid(2), "Versión", "Artista", 180), sp(sid(1), "Canción - Remastered 2011", "Artista", 200)]

function publicSpotify({ tracks = PUBLIC_TRACKS, pageSize = 500, token = "public-session", redirect = PUBLIC_URL } = {}) {
  const calls = []
  const row = (track) => ({ uri: `spotify:${track.type}:${track.id}`, title: track.name, subtitle: track.artists.map((a) => a.name).join(", "), duration: track.duration_ms })
  const embed = (entity) => new Response(`<script type="application/json" id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { state: { data: { entity }, settings: { session: { accessToken: token } } } } } })}</script>`)
  const fetch = async (input, init) => {
    const url = new URL(input)
    calls.push(url)
    assert.equal(init.redirect, "manual")
    if (url.hostname === "spclient.wg.spotify.com") {
      assert.equal(init.headers.Authorization, `Bearer ${token}`)
      const pos = Number(url.searchParams.get("from"))
      const items = tracks.slice(pos, pos + pageSize).map((track) => ({ uri: row(track).uri }))
      return Response.json({ length: tracks.length, revision: "revision-1", attributes: { name: "Viaje" }, contents: { pos, items, truncated: pos + items.length < tracks.length } })
    }
    assert.equal(init.headers.Authorization, undefined)
    if (url.hostname === "spotify.link") return new Response(null, { status: 302, headers: { Location: redirect } })
    if (url.pathname === `/embed/playlist/${PUBLIC_ID}`) return embed({ type: "playlist", uri: `spotify:playlist:${PUBLIC_ID}`, name: "Viaje", trackList: tracks.slice(0, 100).map(row) })
    const track = tracks.find((t) => url.pathname === `/embed/track/${t.id}`)
    if (track) return embed({ ...row(track), type: "track", artists: track.artists })
    throw new Error(`Unexpected public Spotify request: ${url}`)
  }
  return { fetch, calls }
}

test("playlist links accept only Spotify playlists and constrain every short-link redirect", async () => {
  for (const link of [PUBLIC_URL, `${PUBLIC_URL}?si=shared`, `spotify:playlist:${PUBLIC_ID}`, `https://open.spotify.com/intl-es/playlist/${PUBLIC_ID}/`, `https://open.spotify.com/embed/playlist/${PUBLIC_ID}`]) {
    assert.equal(spotifyPlaylistLink(link), PUBLIC_URL)
  }
  for (const link of [null, "", "x".repeat(2049), "http://127.0.0.1/", `http://open.spotify.com/playlist/${PUBLIC_ID}`, `https://open.spotify.com:8443/playlist/${PUBLIC_ID}`, `https://open.spotify.com.evil.example/playlist/${PUBLIC_ID}`, `https://user@open.spotify.com/playlist/${PUBLIC_ID}`, `https://open.spotify.com/track/${PUBLIC_ID}`, "https://spotify.link/a/b"]) {
    assert.throws(() => spotifyPlaylistLink(link), /enlace de una lista/)
  }
  const short = publicSpotify()
  assert.equal((await readSpotifyPlaylist("https://spotify.link/short?si=shared", short)).tracks.length, 3)
  assert.equal(short.calls[0].href, "https://spotify.link/short")
  const unsafe = publicSpotify({ redirect: "http://127.0.0.1/private" })
  await assert.rejects(readSpotifyPlaylist("https://spotify.link/short", unsafe), /enlace de una lista/)
  assert.equal(unsafe.calls.length, 1)
  const loop = publicSpotify({ redirect: "https://spotify.link/short" })
  await assert.rejects(readSpotifyPlaylist("https://spotify.link/short", loop), /enlace de una lista/)
  assert.equal(loop.calls.length, 3)
})

test("a public playlist is paged beyond 100 tracks and metadata is read in its original order", async () => {
  const tracks = Array.from({ length: 103 }, (_, i) => sp(sid(i), `Canción ${i}`, "Artista", 100 + i))
  const source = publicSpotify({ tracks, pageSize: 40 })
  const progress = []
  const list = await readSpotifyPlaylist(PUBLIC_URL, { ...source, progress: (done, total) => progress.push([done, total]) })
  assert.equal(list.name, "Viaje")
  assert.equal(list.unavailable, 0)
  assert.deepEqual(list.tracks.map((t) => [t.id, t.title, t.duration]), tracks.map((t) => [t.id, t.name, t.duration_ms / 1000]))
  assert.deepEqual(source.calls.filter((u) => u.hostname === "spclient.wg.spotify.com").map((u) => u.searchParams.get("from")), ["0", "40", "80"])
  assert.equal(source.calls.filter((u) => u.pathname.startsWith("/embed/track/")).length, 3)
  assert.deepEqual(progress.at(-1), [103, 103])
})

test("public playlist reads refuse truncation, edits, missing sessions, oversized lists and long rate limits", async () => {
  const source = publicSpotify({ pageSize: 1 })
  for (const changed of [false, true]) {
    const fetch = async (url, init) => {
      const response = await source.fetch(url, init)
      if (new URL(url).searchParams.get("from") === "1") {
        if (!changed) return new Response(null, { status: 403 })
        return Response.json({ ...await response.json(), revision: "edited" })
      }
      return response
    }
    await assert.rejects(readSpotifyPlaylist(PUBLIC_URL, { fetch }), changed ? /ha cambiado/ : /lista completa/)
  }
  await assert.rejects(readSpotifyPlaylist(PUBLIC_URL, publicSpotify({ token: null })), /lista completa/)
  await assert.rejects(readSpotifyPlaylist(PUBLIC_URL, publicSpotify({ tracks: [] })), /vacía/)
  await assert.rejects(readSpotifyPlaylist(PUBLIC_URL, publicSpotify({ tracks: Array(5001).fill(PUBLIC_TRACKS[0]) })), /5000/)
  await assert.rejects(readSpotifyPlaylist(PUBLIC_URL, { fetch: async () => new Response("x".repeat(4_000_001)) }), /lista completa/)
  const waits = []
  let calls = 0
  await assert.rejects(readSpotifyPlaylist(PUBLIC_URL, {
    fetch: async () => { calls++; return new Response(null, { status: 429, headers: { "Retry-After": "900" } }) },
    wait: async (ms) => { waits.push(ms) },
  }), /limitado/)
  assert.equal(calls, 1)
  assert.deepEqual(waits, [])
})

test("one playlist imports without a Spotify account, preserves order and only creates that profile's new list", async (t) => {
  const source = publicSpotify({ tracks: [...PUBLIC_TRACKS, PUBLIC_TRACKS[0], sp(sid(7), "Episodio", "Podcast", 1000, "episode")] })
  const { call, tokens, searches, finished, base } = await setup(t, { fetch: source.fetch, unconfigured: true })
  assert.equal((await call("/api/playlist-import")).status, 401)
  assert.equal((await call("/api/playlist-import", { method: "POST", body: { url: PUBLIC_URL } })).status, 401)
  assert.equal((await call("/api/playlist-import", { token: tokens.a, method: "POST", body: { url: "http://localhost/private" } })).status, 400)
  assert.equal((await fetch(`${base}/api/playlist-import`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens.a}` }, body: "null" })).status, 400)
  assert.equal(source.calls.length, 0)
  const existing = (await call("/api/playlists", { token: tokens.a, method: "POST", body: { source: "ytdlp", name: "Viaje" } })).body
  await call("/api/me/likes", { token: tokens.a, method: "PUT", body: { source: "ytdlp", kind: "track", item: yt("saved", "Guardada", "Artista", 100) } })
  const started = await call("/api/playlist-import", { token: tokens.a, method: "POST", body: { url: PUBLIC_URL, userId: "someone-else" } })
  assert.equal(started.status, 202)
  const job = await finished(tokens.a, "/api/playlist-import")
  assert.equal(job.status, "done")
  assert.equal(job.result.playlist.name, "Viaje")
  assert.equal(job.result.playlist.songCount, 3)
  assert.equal(job.result.missing, 2)
  const imported = (await call(`/api/playlists/${job.result.playlist.id}`, { token: tokens.a })).body
  assert.deepEqual(imported.tracks.map((t) => t.id), ["yt:s3", "yt:s1", "yt:s3"])
  assert.equal((await call(`/api/playlists/${existing.id}`, { token: tokens.a })).body.songCount, 0)
  assert.equal((await call("/api/playlists?source=ytdlp", { token: tokens.a })).body.length, 2)
  assert.deepEqual((await call("/api/me/likes?source=ytdlp", { token: tokens.a })).body.tracks.map((t) => t.id), ["yt:saved"])
  assert.deepEqual((await call("/api/spotify", { token: tokens.a })).body, { configured: false, job: null })
  assert.equal((await call("/api/playlist-import", { token: tokens.b })).body.job, null)
  assert.equal((await call("/api/playlists?source=ytdlp", { token: tokens.b })).body.length, 0)
  assert.equal((await call(`/api/playlists/${imported.id}`, { token: tokens.b })).status, 404)
  assert.deepEqual(searches.toSorted(), ["Canción Artista", "Otra Artista", "Versión Artista"])
})

test("playlist jobs reject a duplicate start while the separate profile import remains usable", async (t) => {
  const source = publicSpotify()
  let release
  const gate = new Promise((resolve) => { release = resolve })
  t.after(() => release())
  const { call, tokens, finished } = await setup(t, { unconfigured: true, fetch: async (...args) => { await gate; return source.fetch(...args) } })
  assert.equal((await call("/api/playlist-import", { token: tokens.a, method: "POST", body: { url: PUBLIC_URL } })).status, 202)
  assert.equal((await call("/api/playlist-import", { token: tokens.a })).body.job.status, "reading")
  assert.equal((await call("/api/playlist-import", { token: tokens.a, method: "POST", body: { url: PUBLIC_URL } })).status, 409)
  assert.equal((await call("/api/spotify/file?name=spotify_playlists.zip", { token: tokens.a, method: "POST", raw: exportifyZip() })).status, 200)
  assert.equal((await finished(tokens.a)).status, "done")
  release()
  assert.equal((await finished(tokens.a, "/api/playlist-import")).status, "done")
})

test("failed or unmatched playlist imports leave the library empty", async (t) => {
  for (const blocked of [true, false]) {
    const source = publicSpotify({ tracks: [PUBLIC_TRACKS[1]] })
    const fetch = async (url, init) => new URL(url).hostname === "spclient.wg.spotify.com" && blocked ? new Response(null, { status: 403 }) : source.fetch(url, init)
    const { call, tokens, searches, finished } = await setup(t, { fetch, unconfigured: true })
    await call("/api/playlist-import", { token: tokens.a, method: "POST", body: { url: PUBLIC_URL } })
    const job = await finished(tokens.a, "/api/playlist-import")
    assert.equal(job.status, "error")
    assert.match(job.error, blocked ? /lista completa/ : /No se han encontrado/)
    assert.equal((await call("/api/playlists?source=ytdlp", { token: tokens.a })).body.length, 0)
    if (blocked) assert.deepEqual(searches, [])
  }
})
