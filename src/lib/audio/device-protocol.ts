import type { Track } from "../types"

export const playbackActions = ["playList", "playNext", "addToQueue", "jumpTo", "removeAt", "moveQueueItem", "toggle", "setPlaying", "next", "prev", "seek", "setVolume", "toggleMute", "toggleShuffle", "cycleRepeat"] as const
export type PlaybackAction = typeof playbackActions[number]
export interface PlaybackCommand { action: PlaybackAction; args: unknown[] }
export interface PlaybackSnapshot {
  queue: Track[]
  original: Track[]
  index: number
  isPlaying: boolean
  position: number
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: "off" | "all" | "one"
  sourceLabel?: string
}
export interface PlaybackDevice { id: string; name: string; kind: "phone" | "computer" | "tablet" }
export interface DeviceSession {
  devices: PlaybackDevice[]
  activeId: string | null
  pendingId: string | null
  epoch: number
  state: PlaybackSnapshot | null
  commands: (PlaybackCommand & { id: number })[]
  leaseMs: number
}

let router: ((command: PlaybackCommand) => boolean) | null = null
export function configurePlaybackRouter(next: typeof router) { router = next }
export function routePlayback(command: PlaybackCommand) { return router?.(command) ?? false }

export function playbackSnapshot(state: PlaybackSnapshot): PlaybackSnapshot {
  const { queue, original, index, isPlaying, position, duration, volume, muted, shuffle, repeat, sourceLabel } = state
  return { queue, original, index, isPlaying, position, duration, volume, muted, shuffle, repeat, sourceLabel }
}
