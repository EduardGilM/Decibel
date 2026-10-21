import { test } from "node:test"
import assert from "node:assert/strict"
import { drawerDragOffset, drawerGestureIntent, drawerSettleOpen, drawerStartAllowed } from "../src/lib/drawer-gesture.ts"

test("the drawer swipe may start anywhere in the left half, not only at the edge", () => {
  assert.equal(drawerStartAllowed(150, 412), true)
  assert.equal(drawerStartAllowed(206, 412), true)
  assert.equal(drawerStartAllowed(260, 412), false)
})

test("the drawer claims only a clear horizontal swipe in its direction", () => {
  assert.equal(drawerGestureIntent({ dx: 5, dy: 3, kind: "open" }), "wait")
  assert.equal(drawerGestureIntent({ dx: 30, dy: 4, kind: "open" }), "wait")
  assert.equal(drawerGestureIntent({ dx: 60, dy: 10, kind: "open" }), "claim")
  assert.equal(drawerGestureIntent({ dx: 60, dy: 45, kind: "open" }), "reject")
  assert.equal(drawerGestureIntent({ dx: 4, dy: 80, kind: "open" }), "reject")
  assert.equal(drawerGestureIntent({ dx: -60, dy: 0, kind: "open" }), "reject")
  assert.equal(drawerGestureIntent({ dx: -60, dy: 5, kind: "close" }), "claim")
  assert.equal(drawerGestureIntent({ dx: 60, dy: 5, kind: "close" }), "reject")
})

test("the drawer follows the finger and snaps by fling or distance", () => {
  assert.equal(drawerDragOffset({ dx: 50, kind: "open", width: 320 }), 320)
  assert.equal(drawerDragOffset({ dx: 210, kind: "open", width: 320 }), 160)
  assert.equal(drawerDragOffset({ dx: 600, kind: "open", width: 320 }), 0)
  assert.equal(drawerDragOffset({ dx: -150, kind: "close", width: 320 }), 100)
  assert.equal(drawerSettleOpen({ kind: "open", shown: 50, width: 320, velocity: 0.9 }), true)
  assert.equal(drawerSettleOpen({ kind: "open", shown: 200, width: 320, velocity: 0 }), true)
  assert.equal(drawerSettleOpen({ kind: "open", shown: 60, width: 320, velocity: 0 }), false)
  assert.equal(drawerSettleOpen({ kind: "close", shown: 300, width: 320, velocity: -0.9 }), false)
  assert.equal(drawerSettleOpen({ kind: "close", shown: 180, width: 320, velocity: 0 }), false)
})
