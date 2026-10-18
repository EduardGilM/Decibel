import assert from "node:assert/strict"
import test from "node:test"
import { dynamicAccent, sampleCoverColors } from "../src/lib/cover-colors.ts"

const pixels = (...swatches) => new Uint8ClampedArray(swatches.flatMap(([color, count]) => Array.from({ length: count }, () => color).flat()))
const channels = (color) => color.match(/\d+/g).map(Number)
const luminance = (color) => {
  const [r, g, b] = channels(color).map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return r * 0.2126 + g * 0.7152 + b * 0.0722
}
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

test("the accent keeps the dominant artwork family instead of mixing red and blue into purple", () => {
  const colors = sampleCoverColors(pixels([[200, 30, 20, 255], 60], [[20, 40, 200, 255], 40]))
  const [r, g, b] = channels(colors.dominant)
  assert.ok(r > g * 4 && r > b * 4)
  assert.notEqual(colors.dominant, colors.average)
})

test("black borders and white text do not overwhelm the cover colour", () => {
  const colors = sampleCoverColors(pixels([[0, 0, 0, 255], 70], [[255, 255, 255, 255], 10], [[20, 150, 120, 255], 20]))
  const [r, g, b] = channels(colors.dominant)
  assert.ok(g > r * 4 && b > r * 4)
})

test("a tiny coloured mark does not turn a mostly grey cover into a saturated theme", () => {
  const colors = sampleCoverColors(pixels([[130, 130, 130, 255], 99], [[240, 20, 30, 255], 1]))
  const [r, g, b] = channels(dynamicAccent(colors.dominant).primary)
  assert.equal(r, g)
  assert.equal(g, b)
})

test("transparent pixels contribute no colour and empty artwork has no sample", () => {
  const colors = sampleCoverColors(pixels([[255, 0, 0, 0], 90], [[20, 80, 180, 255], 10]))
  assert.equal(colors.average, "rgb(20, 80, 180)")
  assert.equal(colors.dominant, colors.average)
  assert.equal(sampleCoverColors(new Uint8ClampedArray()), undefined)
  assert.equal(sampleCoverColors(pixels([[255, 0, 0, 0], 10])), undefined)
})

test("different nearby cover hues produce different accents without selecting a preset", () => {
  assert.notEqual(dynamicAccent("#b42e55").primary, dynamicAccent("#b42e65").primary)
  assert.deepEqual(dynamicAccent("#abc"), dynamicAccent("#aabbcc"))
  assert.deepEqual(dynamicAccent("#aabbcc"), dynamicAccent("rgb(170, 187, 204)"))
})

test("monochrome covers and missing artwork remain neutral", () => {
  for (const source of ["#000", "#777", "#fff", undefined, "broken", "rgb(999, 0, 0)"]) {
    const [r, g, b] = channels(dynamicAccent(source).primary)
    assert.equal(r, g)
    assert.equal(g, b)
  }
})

test("artwork accents keep accessible contrast for controls and accent text across RGB colours", () => {
  for (let r = 0; r <= 255; r += 51) for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) {
    const source = `rgb(${r}, ${g}, ${b})`
    const { primary, foreground } = dynamicAccent(source)
    assert.ok(contrast(luminance(primary), luminance(foreground)) >= 7, `button contrast: ${source}`)
    assert.ok(contrast(luminance(primary), luminance("rgb(40, 40, 40)")) >= 4.5, `surface contrast: ${source}`)
  }
})
