import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import test from "node:test"
import { browseAuto, resolveAutoPlay, searchAuto } from "../src/lib/android-auto.ts"

const track = (id) => ({ id, title: `Canción ${id}`, artist: "Artista", album: "", duration: 120 })
const tracks = Array.from({ length: 165 }, (_, i) => track(`song:${i}`))
const provider = {
  getStarred: async () => ({ tracks }),
  getPlaylists: async () => [{ id: 'lista:"/ñ', name: "Mi playlist", songCount: 165 }],
  getPlaylist: async (id) => { assert.equal(id, 'lista:"/ñ'); return { name: "Mi playlist", tracks } },
  search: async (query, signal, filter) => {
    assert.equal(query, "Artista"); assert.equal(filter, "tracks")
    return { tracks: [tracks[3]] }
  },
}

test("Auto exposes queue, favorites and playlists, paging without losing tracks", async () => {
  assert.deepEqual((await browseAuto(provider, [], "root")).map((item) => item.id), ["queue", "favorites", "playlists"])
  const playlists = await browseAuto(provider, [], "playlists")
  for (const parent of ["queue", "favorites", playlists[0].id]) {
    let page = parent
    const seen = []
    do {
      const items = await browseAuto(provider, tracks, page)
      assert.ok(items.length <= 81)
      const songs = items.filter((item) => !item.browsable)
      for (const song of songs) {
        const selection = await resolveAutoPlay(provider, tracks, song.id)
        seen.push(selection.tracks[selection.index].id)
      }
      page = items.find((item) => item.browsable)?.id
    } while (page)
    assert.deepEqual(seen, tracks.map((t) => t.id))
  }
})

test("a selection from an old car screen follows identity after reorder and refuses a removed track", async () => {
  const queue = [track('a:"/ñ'), track("b"), track('a:"/ñ')]
  const items = await browseAuto(provider, queue, "queue")
  assert.equal((await resolveAutoPlay(provider, queue, items[2].id)).index, 2)
  const selection = await resolveAutoPlay(provider, [queue[1], queue[0]], items[0].id)
  assert.equal(selection.index, 1)
  assert.equal(selection.inQueue, true)
  await assert.rejects(resolveAutoPlay(provider, [queue[1]], items[0].id), /ya no está/)
})

test("voice search uses the provider, and an empty voice request resumes a collection", async () => {
  assert.deepEqual((await searchAuto(provider, [], "  Artista ")).tracks, [tracks[3]])
  assert.deepEqual((await searchAuto(provider, [tracks[1]], "")).tracks, [tracks[1]])
  assert.deepEqual((await searchAuto(provider, [], "")).tracks, tracks)
  await assert.rejects(searchAuto({ search: async () => ({ tracks: [] }) }, [], "none"), /No se encontraron/)
})

test("invalid or unavailable collections fail instead of playing another song", async () => {
  for (const id of ["track:[]", 'track:["queue","x",-1]', 'track:["unknown","x",0]', "queue"]) {
    await assert.rejects(resolveAutoPlay(provider, tracks, id))
  }
  await assert.rejects(browseAuto(provider, tracks, 'page:["queue",-80]'))
  await assert.rejects(browseAuto({ getStarred: async () => { throw new Error("offline") } }, [], "favorites"), /offline/)
})

test("the release manifest patch registers Auto on fresh and existing projects and is idempotent", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "decibel-auto-manifest-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const manifest = path.join(directory, "AndroidManifest.xml")
  const fresh = `<?xml version="1.0"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:label="Decibel">
        <provider android:name="androidx.core.content.FileProvider" />
    </application>
</manifest>`
  for (const upgrade of [false, true]) {
    const existing = fresh.replace("        <provider", `        <service
            android:name=".MediaPlaybackService"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />
        <provider`)
    await writeFile(manifest, upgrade ? existing : fresh)
    const patch = () => execFileSync("python3", ["src-tauri/android-overlay/patch-manifest.py", manifest])
    patch()
    const first = await readFile(manifest, "utf8")
    patch()
    assert.equal(await readFile(manifest, "utf8"), first)
    const summary = JSON.parse(execFileSync("python3", ["-c", `
import json, sys, xml.etree.ElementTree as ET
r=ET.parse(sys.argv[1]).getroot(); ns="{http://schemas.android.com/apk/res/android}"
print(json.dumps({s.get(ns+"name"): {"exported": s.get(ns+"exported"), "actions": [a.get(ns+"name") for a in s.findall("intent-filter/action")]} for s in r.findall("application/service")}))
`, manifest], { encoding: "utf8" }))
    assert.equal(summary[".MediaPlaybackService"].exported, "false")
    assert.deepEqual(summary[".AutoBrowserService"], { exported: "true", actions: ["android.media.browse.MediaBrowserService"] })
    assert.match(first, /com.google.android.gms.car.application/)
    assert.match(await readFile(path.join(directory, "res/xml/automotive_app_desc.xml"), "utf8"), /<uses name="media"/)
  }
})
