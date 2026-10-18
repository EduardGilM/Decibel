"use client"

import { integratedLoudness } from "@/lib/audio/loudness"
import { normalizationFactor } from "@/lib/audio/transition"
import type { MusicProvider, Track } from "@/lib/types"
import { useLoudness } from "@/stores/loudness"
import { useSettings } from "@/stores/settings"

/** Volume factor for a track (1 when normalisation is off or nothing is known yet). */
export function trackGain(track: Track | undefined) {
  if (!track || !useSettings.getState().normalize) return 1
  return normalizationFactor(track.replayGain, useLoudness.getState().lufs[track.id])
}

/** Re-render key: changes when normalisation is toggled or this track gets measured. */
export function useGainKey(track: Track | undefined) {
  const on = useSettings((s) => s.normalize)
  const measured = useLoudness((s) => (track ? s.lufs[track.id] : undefined))
  return `${on}:${measured ?? ""}:${track?.replayGain?.trackGain ?? ""}`
}

const pending = new Set<string>()

/**
 * Fallback when there is no ReplayGain: download + decode once, measure, cache.
 * Skipped for YouTube (not our files) and very long tracks (memory).
 */
export async function measureLoudness(track: Track, provider: MusicProvider, signal: AbortSignal) {
  if (!useSettings.getState().normalize || provider.kind === "ytdlp") return
  if (Number.isFinite(track.replayGain?.trackGain ?? track.replayGain?.albumGain) || useLoudness.getState().lufs[track.id] !== undefined) return
  if (pending.has(track.id) || track.duration > 15 * 60 || typeof OfflineAudioContext === "undefined") return
  pending.add(track.id)
  try {
    const url = await provider.streamUrl(track, signal)
    const response = await fetch(url, { signal })
    if (!response.ok) return
    const data = await response.arrayBuffer()
    const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data)
    if (signal.aborted) return
    const channels = Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, i) => decoded.getChannelData(i))
    useLoudness.getState().set(track.id, integratedLoudness(channels, decoded.sampleRate))
  } catch {
    /* CORS, decode or abort: keep unnormalised */
  } finally {
    pending.delete(track.id)
  }
}
