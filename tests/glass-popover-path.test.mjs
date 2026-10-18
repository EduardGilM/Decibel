import assert from "node:assert/strict"
import test from "node:test"
import { glassPopoverPath } from "../src/lib/glass-popover-path.ts"

const base = { width: 288, height: 200, radius: 14, arrowWidth: 24, arrowHeight: 11 }
const nums = (d) => d.match(/-?\d+(\.\d+)?/g).map(Number)

test("arrow edge grows the box on the trigger side only", () => {
  assert.deepEqual(glassPopoverPath({ ...base, side: "bottom", at: 100 }).box, { left: 0, top: -11, width: 288, height: 211 })
  assert.deepEqual(glassPopoverPath({ ...base, side: "top", at: 100 }).box, { left: 0, top: 0, width: 288, height: 211 })
  assert.deepEqual(glassPopoverPath({ ...base, side: "right", at: 50 }).box, { left: -11, top: 0, width: 299, height: 200 })
  assert.deepEqual(glassPopoverPath({ ...base, side: "left", at: 50 }).box, { left: 0, top: 0, width: 299, height: 200 })
})

test("tip sits exactly at the requested point on the outer edge", () => {
  assert.match(glassPopoverPath({ ...base, side: "bottom", at: 100 }).d, / 100 0 C /)
  assert.match(glassPopoverPath({ ...base, side: "top", at: 100 }).d, / 100 211 C /)
  assert.match(glassPopoverPath({ ...base, side: "right", at: 60 }).d, / 0 60 C /)
  assert.match(glassPopoverPath({ ...base, side: "left", at: 60 }).d, / 299 60 C /)
})

test("tip is clamped clear of the rounded corners", () => {
  assert.equal(glassPopoverPath({ ...base, side: "top", at: -40 }).at, 26)
  assert.equal(glassPopoverPath({ ...base, side: "top", at: 999 }).at, 262)
})

test("with minCornerRadius the tip can reach a trigger near the end and the corner shrinks", () => {
  // menu pinned to the right screen edge, "…" button centred 22px from its right end
  const near = glassPopoverPath({ ...base, width: 224, side: "bottom", at: 202, minCornerRadius: 6 })
  assert.equal(near.at, 202)
  assert.match(near.d, / 202 0 C /)
  assert.match(near.d, /L 214 11 C /) // top-right corner radius shrank to 10
  assert.equal(glassPopoverPath({ ...base, width: 224, side: "bottom", at: 999, minCornerRadius: 6 }).at, 206)
  // default keeps the full radius clearance
  assert.equal(glassPopoverPath({ ...base, width: 224, side: "bottom", at: 202 }).at, 198)
})

test("path stays inside its box and is closed", () => {
  for (const side of ["top", "right", "bottom", "left"]) {
    for (const extra of [{}, { at: 4, minCornerRadius: 6 }, { at: 999, minCornerRadius: 0 }]) {
    const { d, box } = glassPopoverPath({ ...base, side, at: 120, ...extra })
    assert.ok(d.startsWith("M ") && d.endsWith("Z"))
    const n = nums(d)
    for (let i = 0; i < n.length; i += 2) {
      assert.ok(n[i] >= 0 && n[i] <= box.width, `${side} x ${n[i]}`)
      assert.ok(n[i + 1] >= 0 && n[i + 1] <= box.height, `${side} y ${n[i + 1]}`)
    }
    }
  }
})

test("panels too small for an arrow fall back to a plain rounded rectangle", () => {
  const { d } = glassPopoverPath({ ...base, width: 40, side: "bottom", at: 20 })
  assert.equal((d.match(/C/g) || []).length, 4)
})
