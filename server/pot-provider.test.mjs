import assert from "node:assert/strict"
import { test } from "node:test"
import { cliArguments, potConfig, potStatus } from "./ytdlp.mjs"

const extract = ["--dump-single-json", "--extractor-args", "youtube:skip=hls", "--", "https://www.youtube.com/watch?v=aaaaaaaaaaa"]

test("without a PO token provider the CLI keeps plugins off and the caller's arguments untouched", () => {
  const args = cliArguments(extract, { pot: potConfig({}) })
  assert.ok(args.includes("--no-plugin-dirs"))
  assert.ok(!args.includes("--plugin-dirs"))
  assert.deepEqual(args.slice(-extract.length), extract)
})

test("with a provider the plugin loads only from the runtime folder and mweb joins the youtube arguments", () => {
  const pot = potConfig({ YTDLP_POT_URL: "http://127.0.0.1:4416/", YTDLP_PLUGIN_DIRS: "/opt/runtime/lib/python3.13" })
  const args = cliArguments(extract, { pot })
  assert.ok(!args.includes("--no-plugin-dirs"))
  assert.equal(args[args.indexOf("--plugin-dirs") + 1], "/opt/runtime/lib/python3.13")
  const extractorArgs = args.flatMap((value, index) => args[index - 1] === "--extractor-args" ? [value] : [])
  // yt-dlp keeps only the last value per extractor, so there must be exactly one youtube: entry.
  assert.deepEqual(extractorArgs, ["youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416", "youtube:skip=hls;player_client=default,mweb"])
  assert.equal(args.at(-1), extract.at(-1))
  const plain = cliArguments(["--version"], { pot })
  assert.ok(plain.includes("youtube:player_client=default,mweb"))
})

test("a provider URL without a plugin folder never re-enables the default plugin folders", () => {
  const args = cliArguments(["--version"], { pot: potConfig({ YTDLP_POT_URL: "http://127.0.0.1:4416" }) })
  assert.ok(args.includes("--no-plugin-dirs"))
})

test("provider health is reported without failing the music health check", async () => {
  assert.deepEqual(await potStatus(potConfig({})), { enabled: false })
  const pot = potConfig({ YTDLP_POT_URL: "http://127.0.0.1:4416" })
  assert.deepEqual(await potStatus(pot, async (url) => {
    assert.equal(url, "http://127.0.0.1:4416/ping")
    return new Response(JSON.stringify({ server_uptime: 3, version: "2.0.2" }))
  }), { enabled: true, ok: true, version: "2.0.2" })
  assert.deepEqual(await potStatus(pot, async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }) }), { enabled: true, ok: false, error: "ECONNREFUSED" })
  assert.deepEqual(await potStatus(pot, async () => new Response("no", { status: 500 })), { enabled: true, ok: false, error: "HTTP 500" })
})
