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

beforeEach(() => { useSearch.setState({ q: "", refocus: false, recent: {}, rows: {}, queue: {}, seq: 0 }); storage.clear() })
const ids = (key = scope) => (useSearch.getState().rows[key] ?? []).map((row) => row.item.id)

test("search links preserve album filters and encode titles without adding URL parameters", () => {
  const link = new URL(searchHref("La ley innata & más", "albums"), "http://decibel.test")
  assert.equal(link.pathname, "/search/")
  assert.equal(link.searchParams.get("q"), "La ley innata & más")
  assert.equal(link.searchParams.get("type"), "albums")
  assert.equal(link.searchParams.size, 2)
  assert.equal(searchHref(""), "/search/")
  assert.equal(searchHref("", "albums"), "/search/?type=albums")
})

test("recent searches keep the latest selection first, refresh metadata, cap history and queue the changes", () => {
  for (let i = 0; i < 25; i++) useSearch.getState().remember(scope, track(String(i)))
  useSearch.getState().remember(scope, { ...track("10"), title: "Título actualizado" })
  const rows = useSearch.getState().rows[scope]
  assert.equal(rows.length, 20)
  assert.equal(rows[0].item.title, "Título actualizado")
  assert.equal(ids().filter((id) => id === "yt:10").length, 1)
  assert.equal(useSearch.getState().queue[scope].length, 26)
})

test("the first change on a device starts from the old local list, and confirm keeps what is still queued", () => {
  useSearch.setState({ recent: { [scope]: [track("old1"), track("old2")] } })
  useSearch.getState().remember(scope, track("new"))
  assert.deepEqual(ids(), ["yt:new", "yt:old1", "yt:old2"])
  const [first] = useSearch.getState().queue[scope]
  useSearch.getState().forget(scope, "yt:old1")
  useSearch.getState().confirm(scope, [{ kind: "track", item: track("server"), at: 1 }, { kind: "track", item: track("old1"), at: 0 }], [first.n])
  assert.deepEqual(ids(), ["yt:server"], "the pending delete still applies over the server list")
  assert.equal(useSearch.getState().queue[scope].length, 1)
})

test("recent songs are separated by source, server and Subsonic account", () => {
  const first = searchScope("subsonic", "https://server.test/", "ana")
  const second = searchScope("subsonic", "https://server.test", "luis")
  const otherServer = searchScope("ytdlp", "https://other.test")
  assert.equal(first, searchScope("subsonic", "https://server.test", "ana"))
  useSearch.getState().remember(first, track("a"))
  useSearch.getState().remember(second, track("b"))
  useSearch.getState().remember(otherServer, track("c"))
  assert.deepEqual(Object.values(useSearch.getState().rows).map((rows) => rows[0].item.id), ["yt:a", "yt:b", "yt:c"])
})

test("history and pending changes survive reloads while the search draft and focus do not", async () => {
  useSearch.getState().remember(scope, track("a"))
  useSearch.getState().setQ("A fuego")
  useSearch.getState().setRefocus(true)
  const saved = storage.get("decibel-search")
  assert.deepEqual(Object.keys(JSON.parse(saved).state).sort(), ["queue", "recent", "rows", "seq"])
  useSearch.setState({ q: "", refocus: false, recent: {}, rows: {}, queue: {}, seq: 0 })
  storage.set("decibel-search", saved)
  await useSearch.persist.rehydrate()
  assert.deepEqual(ids(), ["yt:a"])
  assert.equal(useSearch.getState().queue[scope].length, 1)
  assert.equal(useSearch.getState().q, "")
  assert.equal(useSearch.getState().refocus, false)
  useSearch.getState().forget(scope, "yt:a")
  assert.deepEqual(JSON.parse(storage.get("decibel-search")).state.rows[scope], [])
  useSearch.getState().remember(scope, track("b"))
  useSearch.getState().clearRecent(scope)
  assert.deepEqual(ids(), [])
})

test("the recent list of a 0.1.9 device (unversioned storage) survives the upgrade, so it can be uploaded once", async () => {
  // 0.1.9 saved only { recent } with no version; zustand drops unversioned state unless the store migrates it.
  storage.set("decibel-search", JSON.stringify({ state: { recent: { [scope]: [track("old1"), track("old2")] } }, version: 0 }))
  await useSearch.persist.rehydrate()
  assert.deepEqual(useSearch.getState().recent[scope].map((t) => t.id), ["yt:old1", "yt:old2"])
  assert.deepEqual(useSearch.getState().rows, {})
  assert.deepEqual(useSearch.getState().queue, {})
  // Typing in the search box persists the store: the old list must still be there afterwards.
  useSearch.getState().setQ("x")
  assert.deepEqual(JSON.parse(storage.get("decibel-search")).state.recent[scope].map((t) => t.id), ["yt:old1", "yt:old2"])
  // Junk in old storage never breaks start-up.
  storage.set("decibel-search", JSON.stringify({ state: { recent: "nope" }, version: 0 }))
  await useSearch.persist.rehydrate()
  assert.deepEqual(useSearch.getState().recent, {})
})

test("0.1.10/0.1.11 storage (version 1) keeps its synced rows and pending queue", async () => {
  const rows = { [scope]: [{ kind: "track", item: track("s"), at: 5 }] }
  const queue = { [scope]: [{ n: 3, op: "add", kind: "track", item: track("q"), at: 6 }] }
  storage.set("decibel-search", JSON.stringify({ state: { recent: {}, rows, queue, seq: 3 }, version: 1 }))
  await useSearch.persist.rehydrate()
  assert.deepEqual(useSearch.getState().rows, rows)
  assert.deepEqual(useSearch.getState().queue, queue)
  assert.equal(useSearch.getState().seq, 3)
})
