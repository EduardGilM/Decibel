import type { Track } from "./types.ts"

const LOOKAHEAD = 3

/** Small moving window: prepare quick skips without resolving an entire long album. */
export function upcomingTracks(queue: Track[], index: number, repeat: "off" | "all" | "one") {
  if (!queue[index]) return []
  const candidates = repeat === "one" ? [queue[index]] : [
    ...queue.slice(index + 1), ...(repeat === "all" ? queue.slice(0, index + 1) : []),
  ]
  return [...new Map(candidates.map((track) => [track.id, track])).values()].slice(0, LOOKAHEAD)
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return }
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve() }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })
  })
}

/** One background request at a time; back off only when the server is busy. */
export async function prepareQueuedTracks(
  tracks: Track[],
  prepare: (track: Track, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
  pause = wait,
) {
  for (const track of [...new Map(tracks.map((item) => [item.id, item])).values()].slice(0, LOOKAHEAD)) {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (signal.aborted) return
      try { await prepare(track, signal); break } catch (error) {
        if (signal.aborted) return
        if ((error as { status?: number })?.status !== 429 || attempt === 3) break
        await pause(500 * 2 ** attempt, signal)
      }
    }
  }
}
