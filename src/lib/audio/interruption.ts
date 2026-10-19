/**
 * Android interruptions (a call, a WhatsApp voice note, another app recording): the music fades out (~0.6 s) and
 * pauses, and when the interruption ends it comes back with a short fade-in. Only what the interruption paused
 * resumes: if the user plays, pauses or changes song meanwhile, nothing restarts on its own.
 *
 * Native reports begin/end without holding audio focus (the WebView owns it, see DecibelMedia.kt). When the WebView
 * already paused the element on focus loss, `systemPaused()` counts that pause as the interruption's.
 */
export const FADE_MS = 600

export interface InterruptionDeps {
  audio: () => { volume: number; paused: boolean } | null
  playing: () => boolean
  setPlaying: (value: boolean) => void
  now?: () => number
  wait?: (ms: number) => Promise<void>
}

export function createInterruption({ audio, playing, setPlaying, now = Date.now, wait = (ms) => new Promise((done) => setTimeout(done, ms)) }: InterruptionDeps) {
  let held = false, active = false, ours = false, fading = 0, level = 1, systemPauseAt = -Infinity
  const ramp = async (from: number, to: number, ms: number, token: number) => {
    const steps = Math.max(1, Math.round(ms / 30))
    for (let i = 1; i <= steps; i++) {
      await wait(ms / steps)
      const el = audio()
      if (token !== fading || !el) return false
      el.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps)))
    }
    return true
  }
  /** Our own setPlaying calls: not a user action. */
  const set = (value: boolean) => { ours = true; try { setPlaying(value) } finally { ours = false } }
  return {
    get held() { return held },
    async begin() {
      if (active) return
      active = true
      const el = audio()
      if (playing() && el && !el.paused) {
        held = true
        level = el.volume
        const token = ++fading
        const done = await ramp(level, 0, FADE_MS, token)
        if (!done || !held) return
        set(false)
        el.volume = level // the next play starts from the normal level unless we fade it in
      } else if (now() - systemPauseAt < 3000) {
        // The WebView beat us to it (focus loss): that pause belongs to this interruption.
        held = true
        level = el?.volume ?? 1
      }
    },
    async end() {
      if (!active) return
      active = false
      if (!held) return
      held = false
      const el = audio()
      if (!el || playing()) return
      const token = ++fading
      el.volume = 0
      set(true)
      if (!(await ramp(0, level, FADE_MS, token))) { const now = audio(); if (now) now.volume = level }
    },
    /** The WebView paused the element by itself (audio focus lost): `apply` updates the store, not as the user. */
    systemPaused(apply: () => void = () => {}) {
      systemPauseAt = now()
      if (active && !held) held = true
      ours = true
      try { apply() } finally { ours = false }
    },
    /** Any play / pause / song change that is not ours: the user decided, so no auto-resume. */
    userAction() {
      if (ours) return
      if (!held) return
      held = false
      fading++ // stops a fade in progress
      const el = audio()
      if (el && el.volume < level) el.volume = level
    },
  }
}
