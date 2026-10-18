import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"

const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
}
globalThis.window = { localStorage: globalThis.localStorage }
const { searchHref, searchScope, useSearch } = await import("../src/stores/search.ts")
const scope = searchScope("ytdlp")
const track = (id) => ({ id: `yt:${id}`, title: id, artist: "Artista", album: "Álbum", duration: 10 })

beforeEach(() => { useSearch.setState({ q: "", refocus: false, recent: {} }); storage.clear() })

test("search links preserve album filters and encode titles without adding URL parameters", () => {
  const link = new URL(searchHref("La ley innata & más", "albums"), "http://decibel.test")
  assert.equal(link.pathname, "/search/")
  assert.equal(link.searchParams.get("q"), "La ley innata & más")
  assert.equal(link.searchParams.get("type"), "albums")
  assert.equal(link.searchParams.size, 2)
  assert.equal(searchHref(""), "/search/")
  assert.equal(searchHref("", "albums"), "/search/?type=albums")
})

test("recent searches keep the latest selection first, refresh metadata and cap history", () => {
  for (let i = 0; i < 15; i++) useSearch.getState().remember(scope, track(String(i)))
  useSearch.getState().remember(scope, { ...track("10"), title: "Título actualizado" })
  const recent = useSearch.getState().recent[scope]
  assert.equal(recent.length, 12)
  assert.equal(recent[0].title, "Título actualizado")
  assert.equal(recent.filter((item) => item.id === "yt:10").length, 1)
})

test("recent songs are separated by source, server and Subsonic account", () => {
  const first = searchScope("subsonic", "https://server.test/", "ana")
  const second = searchScope("subsonic", "https://server.test", "luis")
  const otherServer = searchScope("ytdlp", "https://other.test")
  assert.equal(first, searchScope("subsonic", "https://server.test", "ana"))
  useSearch.getState().remember(first, track("a"))
  useSearch.getState().remember(second, track("b"))
  useSearch.getState().remember(otherServer, track("c"))
  assert.deepEqual(Object.values(useSearch.getState().recent).map((items) => items[0].id), ["yt:a", "yt:b", "yt:c"])
})

test("history survives reloads while the search draft and focus do not", async () => {
  useSearch.getState().remember(scope, track("a"))
  useSearch.getState().setQ("A fuego")
  useSearch.getState().setRefocus(true)
  const saved = storage.get("decibel-search")
  assert.deepEqual(Object.keys(JSON.parse(saved).state), ["recent"])
  useSearch.setState({ q: "", refocus: false, recent: {} })
  storage.set("decibel-search", saved)
  await useSearch.persist.rehydrate()
  assert.equal(useSearch.getState().recent[scope][0].id, "yt:a")
  assert.equal(useSearch.getState().q, "")
  assert.equal(useSearch.getState().refocus, false)
  useSearch.getState().forget(scope, "yt:a")
  assert.deepEqual(JSON.parse(storage.get("decibel-search")).state.recent[scope], [])
})
