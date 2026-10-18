import assert from "node:assert/strict"
import test from "node:test"
import { armWindow, fadeGains, isIOS, nextAutoTrack, normalizationFactor } from "../src/lib/audio/transition.ts"
import { integratedLoudness } from "../src/lib/audio/loudness.ts"

const q = ["a", "b", "c"].map((id) => ({ id }))

test("next auto track mirrors the player's next(true): repeat one, end of queue, repeat all", () => {
  assert.equal(nextAutoTrack(q, 0, "off").track.id, "b")
  assert.equal(nextAutoTrack(q, 2, "off"), undefined)
  assert.deepEqual(nextAutoTrack(q, 2, "all"), { index: 0, track: q[0] })
  assert.deepEqual(nextAutoTrack(q, 1, "one"), { index: 1, track: q[1] })
  assert.equal(nextAutoTrack([], 0, "all"), undefined)
})

test("equal-power fade keeps total power ~1 and clamps", () => {
  for (const t of [0, 0.25, 0.5, 1]) { const g = fadeGains(t); assert.ok(Math.abs(g.out ** 2 + g.in ** 2 - 1) < 1e-9) }
  assert.deepEqual(fadeGains(-1), { out: 1, in: 0 })
  assert.equal(armWindow(0), 20)
  assert.equal(armWindow(12), 27)
})

test("normalisation only attenuates, prefers ReplayGain, respects peak", () => {
  assert.equal(normalizationFactor(undefined, undefined), 1)
  assert.ok(Math.abs(normalizationFactor({ trackGain: -12 }, undefined) - 10 ** (-6 / 20)) < 1e-9)
  assert.equal(normalizationFactor({ trackGain: 2 }, undefined), 1, "never boosts")
  assert.ok(normalizationFactor({ trackGain: -12 }, -30) < 1, "tags win over measurement")
  assert.ok(Math.abs(normalizationFactor(undefined, -10) - 10 ** (-2 / 20)) < 1e-9)
  assert.equal(normalizationFactor({ trackGain: -6, trackPeak: 2 }, undefined), 0.5)
})

test("iOS detection includes iPadOS desktop UA", () => {
  assert.equal(isIOS({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)" }), true)
  assert.equal(isIOS({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 5 }), true)
  assert.equal(isIOS({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)", platform: "Linux" }), false)
})

test("loudness: louder signal measures higher, silence is gated", () => {
  const sr = 8000, n = sr * 3
  const sine = (amp) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * 440 * i) / sr))
  const loud = integratedLoudness([sine(0.8)], sr), quiet = integratedLoudness([sine(0.1)], sr)
  assert.ok(loud > quiet + 15, `${loud} vs ${quiet}`)
  assert.equal(integratedLoudness([new Float32Array(n)], sr), -70)
})
