import assert from "node:assert/strict"
import { test } from "node:test"
import { useSearch } from "../src/stores/search.ts"

test("confirming a read with nothing queued keeps the queue object (no sync loop)", () => {
  const before = useSearch.getState().queue
  useSearch.getState().confirm("s", [], [])
  assert.equal(useSearch.getState().queue, before)
  useSearch.getState().confirm("s", [], [])
  assert.equal(useSearch.getState().queue, before)
})

test("confirming sent changes removes them from the queue", () => {
  useSearch.getState().clearRecent("t")
  const sent = useSearch.getState().queue.t.map((op) => op.n)
  const before = useSearch.getState().queue
  useSearch.getState().confirm("t", [], sent)
  assert.notEqual(useSearch.getState().queue, before)
  assert.deepEqual(useSearch.getState().queue.t, [])
})
