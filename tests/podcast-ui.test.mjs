import assert from "node:assert/strict"
import test from "node:test"
import { formatTime } from "../src/lib/format.ts"
import { migrateSettings, SETTINGS_DEFAULTS } from "../src/lib/settings-defaults.ts"
import { formatEpisodeDate, formatEpisodeLength, formatRemaining } from "../src/components/podcast/format.ts"

test("player clock shows hours for long episodes", () => {
  assert.equal(formatTime(75), "1:15")
  assert.equal(formatTime(3599), "59:59")
  assert.equal(formatTime(3600 + 62), "1:01:02")
  assert.equal(formatTime(NaN), "0:00")
})

test("episode dates and lengths read naturally in Spanish", () => {
  const now = new Date(2026, 9, 18, 12)
  assert.equal(formatEpisodeDate(new Date(2026, 9, 18, 8).toISOString(), now), "Hoy")
  assert.equal(formatEpisodeDate(new Date(2026, 9, 17, 8).toISOString(), now), "Ayer")
  assert.match(formatEpisodeDate(new Date(2026, 2, 3).toISOString(), now), /^3 mar$/)
  assert.match(formatEpisodeDate(new Date(2024, 2, 3).toISOString(), now), /^3 mar 2024$/)
  assert.equal(formatEpisodeDate(null, now), "")
  assert.equal(formatEpisodeLength(42 * 60), "42 min")
  assert.equal(formatEpisodeLength(3600 + 5 * 60), "1 h 5 min")
  assert.equal(formatEpisodeLength(0), "")
  assert.equal(formatRemaining(3600, 3600 - 23 * 60), "Quedan 23 min")
})

test("old playback settings move to the new defaults once", () => {
  const old = migrateSettings({ crossfade: 4, gapless: false, normalize: false })
  assert.deepEqual(old, { crossfade: 4, gapless: true, normalize: true, defaults: SETTINGS_DEFAULTS })
  const chosen = { crossfade: 0, gapless: false, normalize: false, defaults: SETTINGS_DEFAULTS }
  assert.equal(migrateSettings(chosen), chosen) // a choice made after the migration is kept
})
