import type { MusicProvider, Track } from "../types"
import { readAudio } from "./response.ts"

/** Two complete songs in memory; never added to downloads or persisted on disk. */
export const BUFFER_TRACK_BYTES = 16 * 1024 * 1024
const MAX_TRACKS = 2

export class PlaybackBuffer {
  private scope = ""
  private wanted = new Set<string>()
  private entries = new Map<string, string>()
  private jobs = new Map<string, { controller: AbortController; promise: Promise<void> }>()

  retain(scope: string, ids: string[]) {
    if (scope !== this.scope) this.clear()
    this.scope = scope
    this.wanted = new Set(ids.slice(0, MAX_TRACKS))
    for (const [id, url] of this.entries) if (!this.wanted.has(id)) {
      URL.revokeObjectURL(url)
      this.entries.delete(id)
    }
    for (const [id, job] of this.jobs) if (!this.wanted.has(id)) {
      job.controller.abort()
      this.jobs.delete(id)
    }
  }

  url(scope: string, id: string) { return scope === this.scope ? this.entries.get(id) : undefined }

  /** Called in queue order, after playback starts. Failure leaves normal streaming intact. */
  prepare(track: Track, provider: MusicProvider): Promise<void> {
    const scope = provider.offlineScope
    if (!scope || scope !== this.scope || !this.wanted.has(track.id) || track.podcast || track.id.startsWith("episode:") || this.entries.has(track.id)) return Promise.resolve()
    const existing = this.jobs.get(track.id)
    if (existing) return existing.promise
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)])
    const promise = (async () => {
      const request = provider.downloadRequest ? await provider.downloadRequest(track) : { url: await provider.streamUrl(track, signal) }
      signal.throwIfAborted()
      // Already a local download; the provider can play it directly.
      if (request.url.startsWith("blob:")) return
      const response = await fetch(request.url, { headers: request.headers, credentials: "include", signal })
      const audio = await readAudio(response, BUFFER_TRACK_BYTES, signal)
      signal.throwIfAborted()
      if (this.scope === scope && this.wanted.has(track.id)) this.entries.set(track.id, URL.createObjectURL(audio))
    })().catch(() => { controller.abort() /* Leave normal streaming intact. */ }).finally(() => {
      if (this.jobs.get(track.id)?.controller === controller) this.jobs.delete(track.id)
    })
    this.jobs.set(track.id, { controller, promise })
    return promise
  }

  pause() {
    for (const job of this.jobs.values()) job.controller.abort()
    this.jobs.clear()
  }

  clear() {
    this.pause()
    for (const url of this.entries.values()) URL.revokeObjectURL(url)
    this.entries.clear()
    this.wanted.clear()
    this.scope = ""
  }
}

export const playbackBuffer = new PlaybackBuffer()
