import assert from "node:assert/strict"
import test from "node:test"
import { computeWrapped, rangeStart, MIN_LISTENS } from "../src/lib/wrapped.ts"

process.env.TZ = "Europe/Madrid"
const song = (id, artist = "A", album = "al") => ({ id, title: `T ${id}`, artist, artistId: `ar:${artist}`, album: `Album ${album}`, albumId: album, coverArt: `c-${id}`, duration: 200 })
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime()
const entry = (track, playedAt, listened = 200) => ({ id: `${playedAt}-${track.id}`, track, playedAt, listened })
const now = new Date(2026, 9, 18, 16)

test("range starts are local month / year / all", () => {
  assert.equal(rangeStart("month", now), new Date(2026, 9, 1).getTime())
  assert.equal(rangeStart("year", now), new Date(2026, 0, 1).getTime())
  assert.equal(rangeStart("all", now), 0)
})

test("tops, minutes, repeats, peaks and streaks come from real listens only", () => {
  const a = song("a", "Uno", "x"), b = song("b", "Uno", "x"), c = song("c", "Dos", "y"), d = song("d", "Tres", "z")
  const episode = { ...song("ep"), podcast: { episodeId: "e", podcastId: "p" } }
  const list = [
    entry(a, at(2026, 10, 14, 22)), entry(a, at(2026, 10, 15, 22)), entry(a, at(2026, 10, 15, 22) + 600_000), entry(a, at(2026, 10, 16, 22)),
    entry(b, at(2026, 10, 16, 9), 60), entry(c, at(2026, 10, 17, 22)), entry(c, at(2026, 10, 18, 10)), entry(d, at(2026, 10, 3, 15), 30),
    entry(episode, at(2026, 10, 17, 22), 3000), // podcasts never count
    entry(d, at(2026, 9, 20, 22)), // last month: only in year / all
  ]
  const s = computeWrapped(list, "month", now)
  assert.equal(s.listens, 8)
  assert.equal(s.seconds, 200 * 6 + 60 + 30)
  assert.deepEqual(s.topTracks.map((t) => [t.track.id, t.plays]), [["a", 4], ["c", 2], ["b", 1], ["d", 1]])
  assert.deepEqual(s.topArtists.map((t) => [t.name, t.plays]), [["Uno", 5], ["Dos", 2], ["Tres", 1]])
  assert.equal(s.topArtists[0].coverArt, "c-a")
  // same artist under two ids (YouTube Music channel vs. video search) is one artist
  const dup = computeWrapped([entry(a, at(2026, 10, 10)), entry({ ...c, artist: "uno ", artistId: "ytm-artist:UC1" }, at(2026, 10, 11))], "month", now)
  assert.deepEqual(dup.topArtists.map((t) => [t.plays, t.artistId]), [[2, "ytm-artist:UC1"]])
  assert.deepEqual(s.topAlbums.map((t) => t.id), ["x", "y", "z"])
  assert.equal(s.mostRepeated.track.id, "a")
  assert.equal(s.mostRepeated.bestDayPlays, 2)
  assert.equal(s.mostRepeated.bestDay, new Date(2026, 9, 15).getTime())
  assert.equal(s.peakHour.hour, 22)
  assert.equal(s.peakHour.plays, 5)
  assert.equal(s.streak.longest, 5) // 14 → 18 October
  assert.equal(s.streak.current, 5)
  assert.equal(s.activeDays, 6)
  assert.equal(s.genre, null) // no genre tags: no invented "vibe"
  assert.equal(s.enough, true)
  assert.equal(computeWrapped(list, "year", now).listens, 9)
})

test("thin history: friendly state and missing cards stay null", () => {
  const list = [entry(song("a"), at(2026, 10, 18, 9), 30), entry(song("b"), at(2026, 10, 18, 10), 30)]
  const s = computeWrapped(list, "all", now)
  assert.equal(s.enough, false)
  assert.ok(s.listens < MIN_LISTENS)
  assert.equal(s.mostRepeated, null)
  assert.equal(s.peakHour, null)
  assert.equal(s.streak, null)
  assert.equal(s.partialMinutes, true)
})

test("genre only appears when most listens carry a real tag", () => {
  const rock = (id) => ({ ...song(id), genre: "Rock" })
  const list = Array.from({ length: 6 }, (_, i) => entry(rock(`r${i}`), at(2026, 10, 10 + i))).concat([entry(song("n"), at(2026, 10, 17))])
  assert.deepEqual(computeWrapped(list, "month", now).genre, { name: "Rock", share: 1 })
  assert.equal(computeWrapped(list.slice(5), "month", now).genre, null)
})

test("ties do not make up a favourite hour", () => {
  const list = [9, 9, 9, 22, 22, 22].map((h, i) => entry(song(`s${i}`), at(2026, 10, 5 + i, h)))
  assert.equal(computeWrapped(list, "month", now).peakHour, null)
})

test("the server keeps the longest heard time when the same listen is posted again (no duplicate rows)", async () => {
  const { openDb } = await import("../server/db.mjs")
  const { createLibrary } = await import("../server/library.mjs")
  const db = openDb(":memory:")
  db.prepare("INSERT INTO users (id, username, role, password_hash, created_at) VALUES ('u1', 'Alex', 'admin', 'x', 1)").run()
  const lib = createLibrary(db, { now: () => 2_000_000 })
  const track = song("a")
  lib.addHistory("u1", "ytdlp", { track, playedAt: 1_000_000, listened: 30 })
  lib.addHistory("u1", "ytdlp", { track, playedAt: 1_000_000, listened: 190.4 })
  lib.addHistory("u1", "ytdlp", { track, playedAt: 1_000_000, listened: 120 }) // late, smaller update never lowers it
  const rows = lib.history("u1", "ytdlp")
  assert.equal(rows.length, 1)
  assert.equal(rows[0].listened, 190)
})
