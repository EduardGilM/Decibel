"use client"

import { useEffect } from "react"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { podcastTrack, type PodcastEpisode, type PodcastProgress } from "@/lib/podcasts"
import { PodcastProvider } from "@/lib/providers/podcasts"
import type { Track } from "@/lib/types"
import { brandStorage, usePlayer } from "@/stores/player"
import { useProfile } from "@/stores/profile"

/** Podcasts do not depend on the music source: one client for the whole app (cookie/Bearer of the profile). */
export const podcasts = new PodcastProvider()

export const isPodcast = (track: Track | undefined) => !!track?.podcast
export const hrefPodcast = (id: string) => `/podcast/?id=${encodeURIComponent(id)}`

/** Podcasts need a signed-in Decibel profile (progress and follows live on the server, per profile). */
export const usePodcastsEnabled = () => useProfile((s) => s.status !== "unavailable" && !!s.user)

export const SKIP_BACK = 15
export const SKIP_FORWARD = 30
export const RATES = [0.8, 1, 1.2, 1.5, 1.75, 2] as const

interface PodcastPrefs {
  rate: number
  setRate: (rate: number) => void
  cycleRate: () => void
}

/** Playback speed for episodes (music always plays at 1×). Stored on this device. */
export const usePodcastPrefs = create<PodcastPrefs>()(
  persist(
    (set, get) => ({
      rate: 1,
      setRate: (rate) => set({ rate }),
      cycleRate: () => {
        const i = RATES.findIndex((r) => r === get().rate)
        set({ rate: RATES[(i + 1) % RATES.length] })
      },
    }),
    { name: "decibel-podcasts", storage: brandStorage, partialize: (s) => ({ rate: s.rate }) },
  ),
)

export const formatRate = (rate: number) => `${String(rate).replace(".", ",")}×`

type LiveProgress = Pick<PodcastProgress, "position" | "duration" | "completed">

interface PodcastLive {
  /** What was just heard, so lists update without refetching. */
  progress: Record<string, LiveProgress>
  /** Bumped when an episode is paused or finished: "Continuar escuchando" refetches. */
  version: number
  setProgress: (id: string, value: LiveProgress, bump?: boolean) => void
}

export const usePodcastLive = create<PodcastLive>()((set) => ({
  progress: {},
  version: 0,
  setProgress: (id, value, bump) => set((s) => ({ progress: { ...s.progress, [id]: value }, version: bump ? s.version + 1 : s.version })),
}))

/** Server progress merged with what this device has played since it was loaded. */
export function useEpisodeProgress(episode: PodcastEpisode) {
  const live = usePodcastLive((s) => s.progress[episode.id])
  const position = live?.position ?? episode.progress.position
  const duration = live?.duration || episode.progress.duration || episode.duration
  const completed = live?.completed ?? episode.progress.completed
  return { position, duration, completed, started: !completed && position >= 5, fraction: duration > 0 ? Math.min(1, position / duration) : 0 }
}

/** Resume positions handed over by the screens (their episode data already carries the profile's progress). */
const resumeHints = new Map<string, number>()

/** Plays one episode with the shared player, resuming where this profile left it. */
export function playEpisode(episode: PodcastEpisode) {
  const player = usePlayer.getState()
  const current = player.queue[player.index]
  if (current?.id === episode.id) { player.setPlaying(true); return }
  const live = usePodcastLive.getState().progress[episode.id]
  const completed = live?.completed ?? episode.progress.completed
  const position = live ? live.position : episode.progress.resumePosition
  resumeHints.set(episode.id, completed ? 0 : position)
  player.playList([podcastTrack(episode)], 0, `podcast:${episode.podcastId}`)
}

/** Seek relative to the current position (±15/30 s buttons, notification, headset). */
export function skipBy(seconds: number) {
  const player = usePlayer.getState()
  const position = player.audio?.currentTime ?? player.position
  const duration = player.audio && isFinite(player.audio.duration) ? player.audio.duration : player.duration
  player.seek(Math.max(0, Math.min(position + seconds, duration > 0 ? duration - 1 : position + seconds)))
}

/**
 * Episode side of the audio engine: playback speed, resume from the profile's saved position and
 * progress saving (every 15 s while playing, on pause/seek and when the episode really ends).
 */
export function usePodcastSession() {
  const episodeId = usePlayer((s) => s.queue[s.index]?.podcast?.episodeId)
  const playbackId = usePlayer((s) => s.playbackId)
  const audio = usePlayer((s) => s.audio)
  const rate = usePodcastPrefs((s) => s.rate)

  // Speed: defaultPlaybackRate survives the src changes made by the engine; music is always 1×.
  useEffect(() => {
    if (!audio) return
    const value = episodeId ? rate : 1
    const apply = () => {
      if (audio.defaultPlaybackRate !== value) audio.defaultPlaybackRate = value
      if (audio.playbackRate !== value) audio.playbackRate = value
    }
    apply()
    audio.addEventListener("loadedmetadata", apply)
    audio.addEventListener("play", apply)
    return () => {
      audio.removeEventListener("loadedmetadata", apply)
      audio.removeEventListener("play", apply)
    }
  }, [audio, episodeId, rate])

  // Resume: applied once the new source has metadata (the engine loads it after this effect runs).
  useEffect(() => {
    if (!audio || !episodeId) return
    const controller = new AbortController()
    let target: number | null = resumeHints.has(episodeId) ? resumeHints.get(episodeId)! : null
    resumeHints.delete(episodeId)
    const apply = () => {
      if (target == null || usePlayer.getState().queue[usePlayer.getState().index]?.podcast?.episodeId !== episodeId) return
      const at = target
      target = null
      const duration = audio.duration
      if (at < 5 || audio.currentTime > 2 || (isFinite(duration) && at > duration - 10)) return
      usePlayer.getState().seek(at)
    }
    if (target == null) {
      podcasts.getProgress(episodeId, controller.signal).then((progress) => {
        if (controller.signal.aborted) return
        target = progress.completed ? 0 : progress.resumePosition
        if (audio.readyState >= 1 && audio.getAttribute("src")) apply()
      }).catch(() => {})
    }
    audio.addEventListener("loadedmetadata", apply)
    return () => {
      controller.abort()
      audio.removeEventListener("loadedmetadata", apply)
    }
  }, [audio, episodeId, playbackId])

  // Progress saving. Without expectedRevision the latest position from any device wins.
  useEffect(() => {
    if (!audio || !episodeId) return
    let sent = -1, sentAt = 0, finished = false
    const save = (reason: "tick" | "pause" | "seek" | "leave" | "end") => {
      if (finished || !audio.getAttribute("src")) return
      const duration = isFinite(audio.duration) ? audio.duration : 0
      const completed = reason === "end"
      const position = completed ? duration || audio.currentTime : audio.currentTime
      if (!completed && (position < 1 || Math.abs(position - sent) < 1)) return
      if (completed) finished = true
      sent = position
      sentAt = Date.now()
      usePodcastLive.getState().setProgress(episodeId, { position, duration, completed }, reason !== "tick" && reason !== "seek")
      podcasts.saveProgress(episodeId, { position, duration, completed }).catch(() => {})
    }
    const onTime = () => { if (!audio.paused && Date.now() - sentAt > 15_000) save("tick") }
    const onPause = () => save("pause")
    const onSeeked = () => save("seek")
    const onEnded = () => save("end")
    const onHide = () => { if (document.visibilityState === "hidden") save("leave") }
    audio.addEventListener("timeupdate", onTime)
    audio.addEventListener("pause", onPause)
    audio.addEventListener("seeked", onSeeked)
    audio.addEventListener("ended", onEnded)
    document.addEventListener("visibilitychange", onHide)
    return () => {
      save("leave")
      audio.removeEventListener("timeupdate", onTime)
      audio.removeEventListener("pause", onPause)
      audio.removeEventListener("seeked", onSeeked)
      audio.removeEventListener("ended", onEnded)
      document.removeEventListener("visibilitychange", onHide)
    }
  }, [audio, episodeId])
}
