import type { Track } from "../types"

export type Repeat = "off" | "all" | "one"

/** The track `next(auto=true)` will pick, so the idle deck can be armed with exactly that song. */
export function nextAutoTrack(queue: Track[], index: number, repeat: Repeat): { index: number; track: Track } | undefined {
  if (!queue.length || !queue[index]) return undefined
  if (repeat === "one") return { index, track: queue[index] }
  if (index < queue.length - 1) return { index: index + 1, track: queue[index + 1] }
  if (repeat === "all") return { index: 0, track: queue[0] }
  return undefined
}

/** Equal-power crossfade curve, t in [0,1]. Keeps perceived loudness flat through the overlap. */
export function fadeGains(t: number) {
  const x = Math.min(1, Math.max(0, t))
  return { out: Math.cos((x * Math.PI) / 2), in: Math.sin((x * Math.PI) / 2) }
}

export const MAX_CROSSFADE = 12

/** Seconds before the end at which the next song is preloaded on the idle deck. */
export const armWindow = (crossfade: number) => Math.max(20, crossfade + 15)

/** iOS Safari: element volume is read-only and play() on a second element needs a gesture. */
export function isIOS(nav: { userAgent: string; platform?: string; maxTouchPoints?: number }) {
  return /iP(hone|ad|od)/.test(nav.userAgent) || (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1)
}

/** ReplayGain 2.0 reference is -18 LUFS; +6 dB pre-amp so typical modern masters are only trimmed a little. */
export const PREAMP_DB = 6
export const REFERENCE_LUFS = -18

export interface GainInfo { trackGain?: number; trackPeak?: number; albumGain?: number }

/**
 * Linear factor applied to element.volume (so it can only attenuate, never boost or clip).
 * Prefers ReplayGain tags; falls back to measured loudness; else 1.
 */
export function normalizationFactor(replayGain: GainInfo | undefined, measuredLufs: number | undefined, preamp = PREAMP_DB) {
  let db: number | undefined
  if (replayGain && Number.isFinite(replayGain.trackGain ?? replayGain.albumGain)) db = (replayGain.trackGain ?? replayGain.albumGain)! + preamp
  else if (measuredLufs !== undefined && Number.isFinite(measuredLufs)) db = REFERENCE_LUFS - measuredLufs + preamp
  if (db === undefined) return 1
  let factor = Math.pow(10, db / 20)
  if (replayGain?.trackPeak && replayGain.trackPeak > 0) factor = Math.min(factor, 1 / replayGain.trackPeak)
  return Math.min(1, Math.max(0.05, factor))
}
