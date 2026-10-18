import assert from "node:assert/strict"
import test from "node:test"
import { activeLyricsLine, findLyrics, findLyricsWithRetry, lyricsLookup, parseLrc, selectLyrics } from "../src/lib/lyrics.ts"

const track = { id: "yt:-byTiKtOrH4", title: "Extremoduro - Dulce introducción al caos (Audio Oficial)", artist: "Extremoduro (Oficial)", album: "YouTube", duration: 463 }
const record = { id: 1, trackName: "Dulce Introducción al Caos", artistName: "Extremoduro", duration: 462, instrumental: false, plainLyrics: "Primera línea de prueba\nSegunda línea de prueba", syncedLyrics: "[00:02.00]Primera línea de prueba\n[00:05.25]Segunda línea de prueba" }

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
