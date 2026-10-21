/**
 * Playback watchdog: never an endless spinner on play, never a silent "playing" song.
 *
 * The audio engine samples it about once a second with the active deck's position. While the user wants
 * music and it does not really play for `timeoutMs` (stream URL never resolved, connection to the audio
 * host stalled or throttled, `waiting` that never ends, play() that never settles…) it asks for a retry, up
 * to `maxRetries` times, and then for a skip to the next song. Media errors go through `fail()` with the
 * same budget. Real progress (a few seconds of audio) or a new play from the user refills the budget.
 *
 * "Really play" means the position advances at least at `MIN_RATE` of real time. A throttled stream that
 * trickles a fraction of a second now and then (stop-and-go, mostly silence) counts as stuck: those crumbs
 * used to restart the clock forever, so the song stayed silent until the user changed it. The stuck time is
 * only forgotten after `HEALTHY_MS` of continuous playback.
 */
export const STALL_TIMEOUT_MS = 12_000
export const MAX_RETRIES = 2
/** Seconds of audio that must play after a retry before the retry budget is refilled. */
export const RECOVERED_AFTER_S = 5
/** Below this fraction of real time a second of "playback" counts as stuck. */
export const MIN_RATE = 0.5
/** Continuous real playback needed to forget earlier stuck seconds. */
export const HEALTHY_MS = 3_000

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
  /** Offline waits preserve both the song and the retry budget. */
  online?: boolean
}

export class PlaybackWatchdog {
  private key = ""
  private lastNow = 0
  private lastPosition = -1
  /** Milliseconds without real progress since the last healthy stretch. */
  private stuck = 0
  /** Milliseconds of continuous real progress. */
  private healthy = 0
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
    this.lastNow = s.now
    this.lastPosition = s.position
    this.stuck = 0
    this.healthy = 0
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
    if (!s.wantsPlaying || s.online === false) {
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
    const dt = Math.max(0, s.now - this.lastNow), moved = s.position - this.lastPosition
    this.lastNow = s.now
    this.lastPosition = s.position
    // A seek (backwards, or far ahead of the clock) is a new starting point, not progress or a stall.
    if (moved < 0 || moved * 1000 > dt * 3 + 1000) {
      this.stuck = 0
      this.healthy = 0
      return null
    }
    if (dt > 0 && moved * 1000 >= dt * MIN_RATE) {
      this.healthy += dt
      if (this.healthy >= HEALTHY_MS) {
        this.stuck = 0
        if (this.attempts && s.position - this.retryPosition >= RECOVERED_AFTER_S) this.attempts = 0
      }
      return null
    }
    this.healthy = 0
    this.stuck += dt
    if (this.stuck < this.timeoutMs) return null
    return this.decide(s)
  }

  /** The media element reported an error for the current playback: retry or skip right away. */
  fail(s: WatchdogSample): WatchdogAction {
    if (s.online === false) { this.sample(s); return null }
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
