import type { Track } from "./types"

export interface ListeningSnapshot {
  queue: Track[]
  original: Track[]
  index: number
  position: number
  duration: number
  shuffle: boolean
  repeat: "off" | "all" | "one"
  sourceLabel?: string
}

export type ResumeOptions = Pick<ListeningSnapshot, "position" | "original" | "shuffle" | "repeat">
export interface BrowseHistory { last?: ListeningSnapshot; recent: Track[] }
export const MAX_BROWSE_RECENT = 12

export function playbackPosition(position: number, duration: number) {
  return Number.isFinite(position) ? Math.max(0, Math.min(position, duration > 0 && Number.isFinite(duration) ? duration : Infinity)) : 0
}

export function rememberPlayback(history: BrowseHistory | undefined, state: ListeningSnapshot): BrowseHistory | undefined {
  const track = state.queue[state.index]
  if (!track || track.podcast) return history
  const { queue, original, index, duration, shuffle, repeat, sourceLabel } = state
  // Likes can change independently of this saved queue.
  const stored = (t: Track) => { const copy = { ...t }; delete copy.starred; return copy }
  return {
    last: { queue: queue.map(stored), original: original.map(stored), index, duration, shuffle, repeat, sourceLabel, position: playbackPosition(state.position, duration || track.duration) },
    recent: [stored(track), ...(history?.recent ?? []).filter((t) => t.id !== track.id)].slice(0, MAX_BROWSE_RECENT),
  }
}

export interface TrackedPlayback extends ListeningSnapshot { isPlaying: boolean; buffering: boolean; playbackId: number }

/** Only an explicit playback starts tracking; a queue left by another profile is never adopted. */
export function createBrowseTracker(save: (state: ListeningSnapshot) => void, now = () => Date.now()) {
  let active = false, lastSave = -Infinity
  return (state: TrackedPlayback, previous: TrackedPlayback, flush = false) => {
    const track = state.queue[state.index]
    const started = state.playbackId !== previous.playbackId || (!previous.isPlaying && state.isPlaying)
    if (started && state.isPlaying) active = true
    if (!track || track.podcast) { active = false; return }
    if (!active || state.buffering) return
    const changed = started || state.queue !== previous.queue || state.index !== previous.index || state.shuffle !== previous.shuffle || state.repeat !== previous.repeat
    const seeked = Math.abs(state.position - previous.position) > 1
    if (flush || changed || seeked || !state.isPlaying || now() - lastSave >= 2000) {
      save(state)
      lastSave = now()
    }
  }
}
