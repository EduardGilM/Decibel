/**
 * Playback watchdog: never an endless spinner on play.
 *
 * The audio engine samples it about once a second with the active deck's position. While the user wants
 * music and the position does not move for `timeoutMs` (stream URL never resolved, connection to the audio
 * host stalled, `waiting` that never ends, play() that never settles…) it asks for a retry, up to
 * `maxRetries` times, and then for a skip to the next song. Media errors go through `fail()` with the
 * same budget. Real progress (a few seconds of audio) or a new play from the user refills the budget.
 */
export const STALL_TIMEOUT_MS = 12_000
export const MAX_RETRIES = 2
/** Seconds of audio that must play after a retry before the retry budget is refilled. */
export const RECOVERED_AFTER_S = 5

export type WatchdogAction =
  /** Reload the same song; `refresh` asks the server for a fresh audio URL, `resumeAt` is where to continue. */
  | { type: "retry"; attempt: number; refresh: boolean; resumeAt: number }
  | { type: "skip" }
  | null

export interface WatchdogSample {
  now: number
  /** Identifies one playback (playbackId + track id): a new key starts from scratch. */
  key: string
  /** The user wants sound (playing, and not waiting for radio recommendations). */
  wantsPlaying: boolean
  /** Current time of the active deck, in seconds. */
  position: number
  /** The stream URL is on the element (false while it is still being resolved). */
  resolved: boolean
}

export class PlaybackWatchdog {
  private key = ""
  private since = 0
  private lastPosition = -1
  private attempts = 0
  private retryPosition = 0
  private wasPlaying = false
  private readonly timeoutMs: number
  private readonly maxRetries: number

  constructor({ timeoutMs = STALL_TIMEOUT_MS, maxRetries = MAX_RETRIES }: { timeoutMs?: number; maxRetries?: number } = {}) {
    this.timeoutMs = timeoutMs
    this.maxRetries = maxRetries
  }

  get retries() { return this.attempts }

  private restart(s: WatchdogSample) {
    this.since = s.now
    this.lastPosition = s.position
  }

  private decide(s: WatchdogSample): WatchdogAction {
    this.restart(s)
    if (this.attempts >= this.maxRetries) return { type: "skip" }
    this.attempts++
    this.retryPosition = s.position
    // Only re-extract when the URL had arrived and the audio itself failed or stalled; while it is still being
    // resolved the server keeps working on it, so the retry joins that request instead of starting over.
    return { type: "retry", attempt: this.attempts, refresh: s.resolved, resumeAt: s.position }
  }

  sample(s: WatchdogSample): WatchdogAction {
    if (s.key !== this.key) {
      this.key = s.key
      this.attempts = 0
      this.retryPosition = 0
      this.wasPlaying = s.wantsPlaying
      this.restart(s)
      return null
    }
    if (!s.wantsPlaying) {
      this.wasPlaying = false
      this.restart(s)
      return null
    }
    if (!this.wasPlaying) {
      // Pressing play again is a fresh start for this song.
      this.wasPlaying = true
      this.attempts = 0
      this.restart(s)
      return null
    }
    if (s.position !== this.lastPosition) {
      if (this.attempts && s.position - this.retryPosition >= RECOVERED_AFTER_S) this.attempts = 0
      this.restart(s)
      return null
    }
    if (s.now - this.since < this.timeoutMs) return null
    return this.decide(s)
  }

  /** The media element reported an error for the current playback: retry or skip right away. */
  fail(s: WatchdogSample): Exclude<WatchdogAction, null> {
    if (s.key !== this.key) {
      this.key = s.key
      this.attempts = 0
      this.retryPosition = 0
    }
    this.wasPlaying = true
    return this.decide(s) as Exclude<WatchdogAction, null>
  }
}

/** Whether `next()` moved on (new playback, or radio recommendations on their way) rather than stopping at the end. */
export function advanced(before: { playbackId: number }, after: { playbackId: number; loadingRecommendations: boolean }) {
  return after.playbackId !== before.playbackId || after.loadingRecommendations
}

/** Bound on radio recommendations so the play button never spins on them for long. */
export const RECOMMENDATIONS_TIMEOUT_MS = 20_000
