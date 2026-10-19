import assert from "node:assert/strict"
import test from "node:test"
import { activeLyricsLine, findLyrics, findLyricsWithRetry, lyricsLookup, parseLrc, selectLyrics } from "../src/lib/lyrics.ts"

const track = { id: "yt:-byTiKtOrH4", title: "Extremoduro - Dulce introducción al caos (Audio Oficial)", artist: "Extremoduro (Oficial)", album: "YouTube", duration: 463 }
const record = { id: 1, trackName: "Dulce Introducción al Caos", artistName: "Extremoduro", duration: 462, instrumental: false, plainLyrics: "Primera línea de prueba\nSegunda línea de prueba", syncedLyrics: "[00:02.00]Primera línea de prueba\n[00:05.25]Segunda línea de prueba" }

function mockLyricsStorage(t, entries) {
  const original = globalThis.localStorage
  const values = new Map([["decibel-lyrics", JSON.stringify(entries)]])
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  t.after(() => { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original })
  return values
}

test("YouTube lookup uses the artist and song instead of display annotations or channel names", () => {
  assert.deepEqual(lyricsLookup(track), { title: "Dulce introducción al caos", artist: "Extremoduro", duration: 463 })
  assert.deepEqual(lyricsLookup({ ...track, title: "Extremoduro — Dulce introducción al caos [Letra]", artist: "Band Lyrics" }), { title: "Dulce introducción al caos", artist: "Extremoduro", duration: 463 })
  assert.equal(lyricsLookup({ ...track, id: "subsonic-1", title: "Parte uno - Parte dos" }).title, "Parte uno - Parte dos")
  assert.deepEqual(lyricsLookup({ ...track, metadataSource: "ytmusic", artist: "Artista", title: "Parte uno - Parte dos" }), { title: "Parte uno - Parte dos", artist: "Artista", duration: 463 })
})

test("LRC handles repeated timestamps, fractional seconds and instrumental gaps", () => {
  const lines = parseLrc("[ti:Prueba]\n[00:10.5][00:20.05]Estribillo de prueba\r\n[00:02.123]Inicio\n[00:15.00]\nSin tiempo\n[00:99.00]Inválida")
  assert.deepEqual(lines, [
    { time: 2.123, text: "Inicio" }, { time: 10.5, text: "Estribillo de prueba" },
    { time: 15, text: "" }, { time: 20.05, text: "Estribillo de prueba" },
  ])
  assert.equal(activeLyricsLine(lines, 0), -1)
  assert.equal(activeLyricsLine(lines, 10.5), 1)
  assert.equal(activeLyricsLine(lines, 100), 3)
  assert.equal(activeLyricsLine(lines, 3), 0)
})

test("matching recording gets synced lyrics; another duration only gets the words", () => {
  assert.equal(selectLyrics([record], lyricsLookup(track)).lines.length, 2)
  const anotherVersion = selectLyrics([record], { ...lyricsLookup(track), duration: 490 })
  assert.equal(anotherVersion.text, record.plainLyrics)
  assert.deepEqual(anotherVersion.lines, [])
  assert.deepEqual(selectLyrics([record], { ...lyricsLookup(track), duration: 0 }).lines, [])
})

test("usable synced lyrics take priority over closer plain text within the same recording tolerance", () => {
  const lookup = lyricsLookup(track)
  const plain = { ...record, id: 2, duration: track.duration, syncedLyrics: null }
  assert.equal(selectLyrics([plain, record], lookup).id, record.id)
  assert.equal(selectLyrics([plain, { ...record, duration: track.duration - 2 }], lookup).id, record.id)
  assert.equal(selectLyrics([plain, { ...record, duration: track.duration - 2.1 }], lookup).id, plain.id)
  assert.equal(selectLyrics([{ ...plain, syncedLyrics: "No hay tiempos" }, record], lookup).id, record.id)
  assert.deepEqual(selectLyrics([{ ...record, syncedLyrics: "[00:02.00]" }], lookup).lines, [])
})

test("different artists and versions are not silently substituted", () => {
  assert.equal(selectLyrics([{ ...record, artistName: "Otro artista" }], lyricsLookup(track)), null)
  assert.equal(selectLyrics([{ ...record, trackName: "Dulce introducción al caos (En directo)" }], lyricsLookup(track)), null)
  assert.equal(selectLyrics([{ ...record, artistName: "歌手一", trackName: "歌曲" }], { title: "歌曲", artist: "歌手二", duration: 462 }), null)
  assert.equal(selectLyrics([{ ...record, instrumental: true, plainLyrics: null, syncedLyrics: null }], lyricsLookup(track)).instrumental, true)
})

test("when exact lookup misses, search finds the right recording and reuses its cached result", async (t) => {
  const song = { ...track, title: "Prueba de búsqueda", artist: "Artista de prueba", id: "library-lookup" }
  const calls = []
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(new URL(url))
    if (calls.length === 1) return Response.json({}, { status: 404 })
    return Response.json([{ ...record, trackName: song.title, artistName: song.artist }])
  })
  const result = await findLyrics(song)
  assert.equal(result.lines.length, 2)
  assert.equal(calls[0].pathname, "/api/get")
  assert.equal(calls[0].searchParams.get("duration"), "463")
  assert.equal(calls[1].pathname, "/api/search")
  assert.equal(calls[1].searchParams.has("duration"), false)
  assert.deepEqual(await findLyrics(song), result)
  assert.equal(calls.length, 2)
})

test("an exact plain result still searches for compatible synced lyrics", async (t) => {
  const song = { ...track, id: "plain-exact", title: "Letra con alternativa", artist: "Artista de prueba" }
  const exact = { ...record, trackName: song.title, artistName: song.artist, duration: song.duration, syncedLyrics: null }
  const calls = []
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(new URL(url))
    return Response.json(calls.length === 1 ? exact : [{ ...exact, id: 2, duration: song.duration - 1, syncedLyrics: record.syncedLyrics }])
  })
  const result = await findLyrics(song)
  assert.equal(result.id, 2)
  assert.equal(result.lines.length, 2)
  assert.deepEqual(calls.map((url) => url.pathname), ["/api/get", "/api/search"])
  assert.equal(calls[1].searchParams.has("duration"), false)
  assert.deepEqual(await findLyrics(song), result)
  assert.equal(calls.length, 2)
})

test("search keeps the exact plain lyrics when other results belong to a different recording", async (t) => {
  const song = { ...track, id: "plain-kept", title: "Letra sin alternativa", artist: "Artista de prueba" }
  const exact = { ...record, trackName: song.title, artistName: song.artist, syncedLyrics: null }
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => {
    calls++
    return Response.json(calls === 1 ? exact : [{ ...exact, id: 2, duration: 490, syncedLyrics: record.syncedLyrics }])
  })
  const result = await findLyrics(song)
  assert.equal(result.id, exact.id)
  assert.equal(result.text, exact.plainLyrics)
  assert.deepEqual(result.lines, [])
  assert.equal(calls, 2)
})

test("a failed sync search keeps available text and can recover after a short cache interval", async (t) => {
  const song = { ...track, id: "plain-recovery", title: "Letra con búsqueda interrumpida", artist: "Artista de prueba" }
  const exact = { ...record, trackName: song.title, artistName: song.artist, syncedLyrics: null }
  let now = Date.now(), calls = 0
  t.mock.method(Date, "now", () => now)
  t.mock.method(globalThis, "fetch", async (url) => {
    calls++
    if (new URL(url).pathname === "/api/get") return Response.json(exact)
    return calls === 2 ? Response.json({}, { status: 503 }) : Response.json([{ ...exact, syncedLyrics: record.syncedLyrics }])
  })
  assert.equal((await findLyrics(song)).text, exact.plainLyrics)
  assert.deepEqual((await findLyrics(song)).lines, [])
  assert.equal(calls, 2)
  now += 60_001
  assert.equal((await findLyrics(song)).lines.length, 2)
  assert.equal(calls, 4)
})

test("cancelling a sync search does not cache its incomplete plain result", async (t) => {
  const song = { ...track, id: "plain-abort", title: "Letra con búsqueda cancelada", artist: "Artista de prueba" }
  const exact = { ...record, trackName: song.title, artistName: song.artist, syncedLyrics: null }
  const controller = new AbortController()
  t.mock.method(globalThis, "fetch", async (url) => {
    if (new URL(url).pathname === "/api/get") return Response.json(exact)
    controller.abort()
    throw controller.signal.reason
  })
  await assert.rejects(findLyrics(song, controller.signal), { name: "AbortError" })
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...exact, syncedLyrics: record.syncedLyrics }))
  assert.equal((await findLyrics(song)).lines.length, 2)
})

test("legacy persistent plain lyrics are rechecked and upgraded instead of being reused forever", async (t) => {
  const song = { ...track, id: "legacy-plain", title: "Letra guardada antigua", artist: "Artista de prueba" }
  const key = JSON.stringify(lyricsLookup(song))
  const plain = { id: record.id, instrumental: false, text: record.plainLyrics, lines: [] }
  const values = mockLyricsStorage(t, { [key]: plain })
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => {
    calls++
    return Response.json({ ...record, trackName: song.title, artistName: song.artist })
  })
  const result = await findLyrics(song)
  assert.equal(result.lines.length, 2)
  assert.equal(calls, 1)
  const saved = JSON.parse(values.get("decibel-lyrics"))[key]
  assert.deepEqual(saved, { ...result, expires: saved.expires })
  assert.ok(saved.expires > Date.now())
})

test("fresh persistent plain lyrics are reused until expiry, then searched again", async (t) => {
  const song = { ...track, id: "expiring-plain", title: "Letra guardada con caducidad", artist: "Artista de prueba" }
  const key = JSON.stringify(lyricsLookup(song))
  const plain = { id: record.id, instrumental: false, text: record.plainLyrics, lines: [] }
  let now = Date.now(), calls = 0
  t.mock.method(Date, "now", () => now)
  mockLyricsStorage(t, { [key]: { ...plain, expires: now + 10 * 60_000 } })
  t.mock.method(globalThis, "fetch", async () => {
    calls++
    return Response.json({ ...record, trackName: song.title, artistName: song.artist })
  })
  assert.deepEqual(await findLyrics(song), plain)
  assert.equal(calls, 0)
  now += 10 * 60_000 + 1
  assert.equal((await findLyrics(song)).lines.length, 2)
  assert.equal(calls, 1)
})

test("expired saved lyrics remain available when offline", async (t) => {
  const song = { ...track, id: "expired-offline", title: "Letra guardada sin conexión", artist: "Artista de prueba" }
  const key = JSON.stringify(lyricsLookup(song))
  const saved = { id: record.id, instrumental: false, text: record.plainLyrics, lines: parseLrc(record.syncedLyrics) }
  mockLyricsStorage(t, { [key]: { ...saved, expires: Date.now() - 1 } })
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new TypeError("Failed to fetch") })
  assert.deepEqual(await findLyricsWithRetry(song, undefined, [0, 1]), saved)
  assert.equal(calls, 1)
})

test("refreshing saved synced lyrics never downgrades them to plain text", async (t) => {
  const song = { ...track, id: "synced-kept", title: "Letra sincronizada guardada", artist: "Artista de prueba" }
  const key = JSON.stringify(lyricsLookup(song))
  const saved = { id: record.id, instrumental: false, text: record.plainLyrics, lines: parseLrc(record.syncedLyrics) }
  mockLyricsStorage(t, { [key]: { ...saved, expires: Date.now() - 1 } })
  let calls = 0
  t.mock.method(globalThis, "fetch", async (url) => {
    calls++
    return Response.json(new URL(url).pathname === "/api/get" ? { ...record, trackName: song.title, artistName: song.artist, syncedLyrics: null } : [])
  })
  assert.deepEqual(await findLyrics(song), saved)
  assert.equal(calls, 2)
})

test("missing lyrics return an empty state; connection failures remain retryable", async (t) => {
  const missing = { ...track, id: "missing", title: "Canción ausente" }
  t.mock.method(globalThis, "fetch", async () => Response.json([], { status: 200 }))
  assert.equal(await findLyrics(missing), null)
  const unavailable = { ...track, id: "unavailable", title: "Canción temporalmente inaccesible" }
  t.mock.method(globalThis, "fetch", async () => Response.json({}, { status: 503 }))
  await assert.rejects(findLyrics(unavailable), /servicio de letras/)
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...record, trackName: unavailable.title, artistName: "Extremoduro" }))
  assert.equal((await findLyrics(unavailable)).lines.length, 2)
})

test("lyrics retry backs off on errors but never on a plain miss", async (t) => {
  const flaky = { ...track, id: "flaky", title: "Canción con red inestable" }
  let calls = 0
  t.mock.method(globalThis, "fetch", async () => { calls++; if (calls < 3) throw new TypeError("Failed to fetch"); return Response.json({ ...record, trackName: flaky.title, artistName: "Extremoduro" }) })
  assert.equal((await findLyricsWithRetry(flaky, undefined, [0, 1, 1, 1])).lines.length, 2)
  assert.equal(calls, 3)
  const absent = { ...track, id: "absent", title: "Canción sin letra" }
  calls = 0
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({}, { status: 404 }) })
  assert.equal(await findLyricsWithRetry(absent, undefined, [0, 1, 1, 1]), null)
  assert.equal(calls, 2) // get + search, a single attempt
  const down = { ...track, id: "down", title: "Servicio caído" }
  calls = 0
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({}, { status: 503 }) })
  await assert.rejects(findLyricsWithRetry(down, undefined, [0, 1, 1, 1]), /servicio de letras/)
  assert.equal(calls, 4)
})
