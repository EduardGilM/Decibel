import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { after, beforeEach, test } from "node:test"
import { setImmediate as settle } from "node:timers/promises"
import { createElement } from "react"
import { renderToString } from "react-dom/server"

// Exercise the real store with controlled provider responses and browser events.
const originalWindow = globalThis.window
globalThis.window = new EventTarget()
let provider = { getPlaylists: async () => [] }
globalThis.decibelMembershipTestProvider = () => provider
const stub = "data:text/javascript," + encodeURIComponent("export const getProvider = () => globalThis.decibelMembershipTestProvider()")
const resolver = registerHooks({
  resolve(specifier, context, next) {
    return specifier === "@/lib/providers" ? { url: stub, shortCircuit: true } : next(specifier, context)
  },
})
const { useInPlaylist, usePlaylistMembership } = await import("../src/stores/playlist-membership.ts")
resolver.deregister()
function MembershipConsumer() { useInPlaylist("test"); return null }
renderToString(createElement(MembershipConsumer))
await settle()

const refresh = () => usePlaylistMembership.getState().refresh()
const lists = () => Object.fromEntries(Object.entries(usePlaylistMembership.getState().lists).map(([id, songs]) => [id, songs.map((song) => song.id)]))
const changeProfile = () => window.dispatchEvent(new Event("decibel:profile-changed"))
const summary = (id, rev = 1) => ({ id, name: id, editable: true, songCount: 1, rev })
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }

beforeEach((t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  provider = { getPlaylists: async () => [] }
  changeProfile()
})
after(() => {
  globalThis.window = originalWindow
  delete globalThis.decibelMembershipTestProvider
})

test("a pending track response cannot restore memberships from a previous profile", async () => {
  const started = deferred(), tracks = deferred(), current = deferred()
  provider = {
    getPlaylists: async () => [summary("previous-list")],
    getPlaylist: () => { started.resolve(); return tracks.promise },
  }
  const previous = refresh()
  await started.promise
  provider = { getPlaylists: () => current.promise }
  changeProfile()
  void refresh() // A new profile requests a refresh while the old request is pending.
  try {
    tracks.resolve({ tracks: [{ id: "previous-track" }] })
    await previous
    assert.deepEqual(lists(), {})
  } finally {
    current.resolve([{ ...summary("current-list"), tracks: [{ id: "current-track" }] }])
    await settle()
  }
  assert.deepEqual(lists(), { "current-list": ["current-track"] })
})

test("an old summary response does not start track requests after the profile changes", async () => {
  const summaries = deferred()
  let oldTrackRequests = 0
  provider = {
    getPlaylists: () => summaries.promise,
    getPlaylist: async () => { oldTrackRequests++; return { tracks: [{ id: "old" }] } },
  }
  const previous = refresh()
  provider = { getPlaylists: async () => [] }
  changeProfile()
  void refresh()
  summaries.resolve([summary("previous-list")])
  await previous
  await settle()
  assert.equal(oldTrackRequests, 0)
  assert.deepEqual(lists(), {})
})

test("a failed batch preserves cached versions so the next refresh retries changed lists", async () => {
  let revision = 1, failing = false, aRequests = 0
  provider = {
    getPlaylists: async () => [summary("a", revision), summary("b", revision)],
    getPlaylist: async (id) => {
      if (id === "a") aRequests++
      if (id === "b" && failing) throw new Error("offline")
      return { tracks: [{ id: `${id}-${revision}` }] }
    },
  }
  await refresh()
  await refresh()
  assert.equal(aRequests, 1) // Unchanged summaries reuse the cache.
  revision = 2; failing = true
  await refresh()
  assert.deepEqual(lists(), { a: ["a-1"], b: ["b-1"] })
  failing = false
  await refresh()
  assert.equal(aRequests, 3)
  assert.deepEqual(lists(), { a: ["a-2"], b: ["b-2"] })
})
