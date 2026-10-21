import assert from "node:assert/strict"
import test from "node:test"
import { PALETTE, profileColor } from "../src/lib/profile-color.ts"

test("a profile keeps its own colour, or gets a stable one from its name", () => {
  assert.equal(profileColor("Eduard", "#123456"), "#123456")
  assert.equal(profileColor("Ana"), profileColor("Ana"))
  assert.ok(PALETTE.includes(profileColor("Ana")))
  assert.notEqual(new Set(["Ana", "Eduard", "Marta", "Luis", "Sara"].map((n) => profileColor(n))).size, 1)
})
