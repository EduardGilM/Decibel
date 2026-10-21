import assert from "node:assert/strict"
import { test } from "node:test"
import { shortcutKey } from "../src/lib/keyboard-shortcuts.ts"

const event = (key, extra = {}) => ({ key, code: key === " " ? "Space" : key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false, isComposing: false, ...extra })

test("desktop playback, seek, previous/next, search, mute and like keys resolve", () => {
  for (const key of [" ", "ArrowLeft", "ArrowRight", "/", "m", "l"]) assert.equal(shortcutKey(event(key), false), key === " " ? "Space" : key)
  for (const key of ["ArrowLeft", "ArrowRight"]) assert.equal(shortcutKey(event(key, { shiftKey: true }), false), key)
  assert.equal(shortcutKey(event("M"), false), "m")
  assert.equal(shortcutKey(event("k", { ctrlKey: true }), false), "focus-search")
  assert.equal(shortcutKey(event("k", { metaKey: true }), false), "focus-search")
})

test("typing, IME composition and already handled events never trigger global shortcuts", () => {
  for (const key of [" ", "ArrowLeft", "ArrowRight", "/", "m", "l", "k"]) {
    assert.equal(shortcutKey(event(key), true), null)
    assert.equal(shortcutKey(event(key, { isComposing: true }), false), null)
    assert.equal(shortcutKey(event(key, { defaultPrevented: true }), false), null)
  }
  assert.equal(shortcutKey(event(" "), false, true), null, "a focused button keeps native Space activation")
})

test("browser modifiers and repeated toggles stay untouched; holding seek and volume arrows works", () => {
  for (const key of [" ", "ArrowLeft", "ArrowRight", "/", "m", "l"]) {
    assert.equal(shortcutKey(event(key, { ctrlKey: true, shiftKey: true }), false), null)
    assert.equal(shortcutKey(event(key, { altKey: true }), false), null)
    assert.equal(shortcutKey(event(key, { metaKey: true }), false), null)
  }
  for (const key of [" ", "m", "l"]) assert.equal(shortcutKey(event(key, { repeat: true }), false), null)
  assert.equal(shortcutKey(event("ArrowRight", { repeat: true }), false), "ArrowRight")
  assert.equal(shortcutKey(event("ArrowUp", { repeat: true }), false), "ArrowUp")
  assert.equal(shortcutKey(event("ArrowRight", { repeat: true, shiftKey: true }), false), null)
})
