import assert from "node:assert/strict"
import { test } from "node:test"
import { trackArtists } from "../src/lib/track-artists.ts"
import { artistRecommendations, MAX_RECOMMENDED_TRACKS } from "../src/lib/artist-recs.ts"

const song = (id, artist, extra = {}) => ({ id: `yt:${id}`, title: `Tema ${id}`, artist, album: "X", duration: 200, ...extra })

test("every credited artist of a catalogue song links to its own page", () => {
  const t = song("a", "Robe, Extremoduro", { artistId: "ytm-artist:UCrobe", artists: [{ id: "ytm-artist:UCrobe", name: "Robe" }, { id: "ytm-artist:UCextremo", name: "Extremoduro" }] })
  assert.deepEqual(trackArtists(t), [{ id: "ytm-artist:UCrobe", name: "Robe" }, { id: "ytm-artist:UCextremo", name: "Extremoduro" }])
})

test("older entries without `artists` keep one link for the whole string; a nameless id-less artist is plain text", () => {
  assert.deepEqual(trackArtists(song("b", "Marea", { artistId: "ytm-artist:UCmarea" })), [{ id: "ytm-artist:UCmarea", name: "Marea" }])
  assert.deepEqual(trackArtists(song("c", "Alguien")), [{ id: undefined, name: "Alguien" }])
  const partial = trackArtists(song("d", "A, B", { artistId: "ytm-artist:UCa", artists: [{ name: "A" }, { name: "B" }, { name: " " }] }))
  assert.deepEqual(partial, [{ id: "ytm-artist:UCa", name: "A" }, { id: undefined, name: "B" }])
})

const EX = "ytm-artist:UCextremo"
const own = (id, extra = {}) => song(id, "Extremoduro", { artistId: EX, artists: [{ id: EX, name: "Extremoduro" }], ...extra })

test("recommendations are only songs of this artist (feats included), never Populares nor repeated", () => {
  const artist = { id: EX, name: "Extremoduro", topTracks: [own("1"), own("2")] }
  const tracks = [
    own("1"), // in Populares
    song("m", "Marea", { artistId: "ytm-artist:UCmarea", artists: [{ id: "ytm-artist:UCmarea", name: "Marea" }] }), // other artist
    own("3"), own("3"),
    song("4", "Robe, Extremoduro", { artistId: "ytm-artist:UCrobe", artists: [{ id: "ytm-artist:UCrobe", name: "Robe" }, { id: EX, name: "Extremoduro" }] }), // feat.
    own("x", { title: "Tema 3 (Remastered)" }), // same song as 3
    song("n", "Extremoduro tributo", { artistId: "ytm-artist:UCother", artists: [{ id: "ytm-artist:UCother", name: "Extremoduro" }] }), // same name, another id
    { ...own("p"), podcast: { episodeId: "e", podcastId: "p" } },
  ]
  const out = artistRecommendations(artist, { tracks, deepCuts: [own("d1"), own("2")], artists: [{ id: "ytm-artist:UCmarea", name: "Marea", albumCount: 0 }, { id: EX, name: "Extremoduro", albumCount: 0 }] }, [])
  assert.deepEqual(out.tracks.map((t) => t.id), ["yt:3", "yt:4", "yt:d1"])
  assert.deepEqual(out.artists.map((a) => a.id), ["ytm-artist:UCmarea"], "similar artists stay a separate list, without self")
})

test("unheard songs first: 7 popular + 3 deep cuts, then fill with heard ones; at most 10", () => {
  const artist = { id: EX, name: "Extremoduro", topTracks: [] }
  const popular = Array.from({ length: 12 }, (_, i) => own("p" + i))
  const deepCuts = Array.from({ length: 5 }, (_, i) => own("d" + i))
  const history = [own("p0"), own("p1"), own("d0")]
  const ids = artistRecommendations(artist, { tracks: popular, deepCuts, artists: [] }, history).tracks.map((t) => t.id.slice(3))
  assert.deepEqual(ids, ["p2", "p3", "p4", "p5", "p6", "p7", "p8", "d1", "d2", "d3"])
  const few = artistRecommendations(artist, { tracks: popular.slice(0, 3), deepCuts: [], artists: [] }, history).tracks.map((t) => t.id.slice(3))
  assert.deepEqual(few, ["p2", "p0", "p1"], "heard songs only fill the gaps, at the end")
})

test("legacy songs without credit ids match by artist name", () => {
  const out = artistRecommendations({ id: EX, name: "Extremoduro" }, { tracks: [song("a", "Extremoduro"), song("b", "Marea")], artists: [] }, [])
  assert.deepEqual(out.tracks.map((t) => t.id), ["yt:a"])
})

test("without catalogue data the section has nothing to show, and it is capped", () => {
  assert.deepEqual(artistRecommendations({ id: "x", name: "X" }, undefined, []), { tracks: [], artists: [] })
  const many = Array.from({ length: 30 }, (_, i) => song(`r${i}`, "X"))
  assert.equal(artistRecommendations({ id: "x", name: "X" }, { tracks: many, artists: [] }, []).tracks.length, MAX_RECOMMENDED_TRACKS)
})
