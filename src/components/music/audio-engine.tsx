"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { getProvider, useProvider } from "@/lib/providers"
import { usePlayer } from "@/stores/player"
import { notePause } from "@/lib/pause-log"
import { useSettings } from "@/stores/settings"
import { armWindow, fadeGains, isIOS, nextAutoTrack } from "@/lib/audio/transition"
import { measureLoudness, trackGain, useGainKey } from "./normalization"
import { useKeyboardShortcuts } from "./keyboard-shortcuts"
import { useListenTracker } from "./use-listen-tracker"
import type { Track } from "@/lib/types"
import { prepareQueuedTracks, upcomingTracks } from "@/lib/prepare-queue"
import { useAuthenticatedArtwork } from "@/hooks/use-authenticated-artwork"
import { SKIP_BACK, SKIP_FORWARD, skipBy, usePodcastSession } from "@/components/podcast/podcast-playback"

/** A deck holding the next song: preloaded (gapless) or fading in (crossfade). */
interface Armed { trackId: string; playbackId: number; deck: HTMLAudioElement }

function clearDeck(deck: HTMLAudioElement | null) {
  if (!deck) return
  deck.pause()
  deck.removeAttribute("src")
  deck.load()
}

/**
 * Owns two <audio> decks, Media Session (lock screen / headphones) and keyboard shortcuts.
 * `ref` always points at the active deck; the other one preloads the next song (gapless) or fades it in (crossfade).
 * iOS Safari: single deck (read-only volume, play() needs a gesture per element).
 */
export function AudioEngine() {
  const ref = useRef<HTMLAudioElement>(null)
  const decks = useRef<[HTMLAudioElement | null, HTMLAudioElement | null]>([null, null])
  const armed = useRef<Armed | null>(null)
  const handoff = useRef<Armed | null>(null)
  const fade = useRef<{ timer: number; from: HTMLAudioElement; to: HTMLAudioElement; inTrack: Track } | null>(null)
  const track = usePlayer((s) => s.queue[s.index])
  const isPlaying = usePlayer((s) => s.isPlaying)
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)
  const playbackId = usePlayer((s) => s.playbackId)
  const repeat = usePlayer((s) => s.repeat)
  const isQueueEnd = usePlayer((s) => s.index === s.queue.length - 1)
  const loadingRecommendations = usePlayer((s) => s.loadingRecommendations)
  const buffering = usePlayer((s) => s.buffering)
  const nearEnd = usePlayer((s) => s.duration > 0 && s.duration - s.position < 45)
  const queue = usePlayer((s) => s.queue)
  const index = usePlayer((s) => s.index)
  const upcoming = useMemo(() => upcomingTracks(queue, index, repeat), [queue, index, repeat])
  const provider = useProvider()
  const mediaCover = useAuthenticatedArtwork(provider.coverUrl(track?.coverArt, 512))
  const [retry, setRetry] = useState(0)
  const ready = useRef(false)
  const failed = useRef(false)
  const refreshUrl = useRef(false)
  const autoRetried = useRef(false)
  const crossfade = useSettings((s) => s.crossfade)
  const gapless = useSettings((s) => s.gapless)
  const normalize = useSettings((s) => s.normalize)
  const [ios] = useState(() => typeof navigator !== "undefined" && isIOS(navigator))
  const dualDeck = !ios && (gapless || crossfade > 0)
  const armNow = usePlayer((s) => s.duration > 0 && s.duration - s.position < armWindow(crossfade))
  const gainKey = useGainKey(track)

  useKeyboardShortcuts()
  useListenTracker()
  usePodcastSession()

  const otherDeck = () => (ref.current === decks.current[0] ? decks.current[1] : decks.current[0])
  const baseVolume = (t: Track | undefined) => Math.min(1, usePlayer.getState().volume * trackGain(t))

  /** End any crossfade now: silence the outgoing deck, settle the incoming one at its normal volume. */
  const finishFade = () => {
    const f = fade.current
    if (!f) return
    window.clearInterval(f.timer)
    fade.current = null
    if (f.from !== ref.current) clearDeck(f.from)
    f.to.volume = baseVolume(f.inTrack)
  }

  /** Called on every timeupdate of the active deck; starts the overlap when the tail reaches the crossfade length. */
  const startCrossfade = (from: HTMLAudioElement) => {
    const state = usePlayer.getState()
    const seconds = useSettings.getState().crossfade
    const take = armed.current
    if (!take || fade.current || ios || seconds <= 0 || state.repeat === "one" || !state.isPlaying || !isFinite(from.duration)) return
    const remaining = from.duration - from.currentTime
    if (remaining > seconds || remaining < 0.5) return
    const upcoming = nextAutoTrack(state.queue, state.index, state.repeat)
    const outgoing = state.queue[state.index]
    if (!upcoming || upcoming.track.id !== take.trackId) return
    armed.current = null
    const to = take.deck
    to.currentTime = 0
    to.volume = 0
    to.play().catch(() => {})
    const started = performance.now(), length = remaining * 1000
    // setInterval, not rAF: keeps fading with the tab in the background (audible tabs are not throttled).
    const timer = window.setInterval(() => {
      const t = (performance.now() - started) / length
      const g = fadeGains(t)
      from.volume = baseVolume(outgoing) * g.out
      to.volume = baseVolume(upcoming.track) * g.in
      if (t >= 1) finishFade()
    }, 50)
    fade.current = { timer, from, to, inTrack: upcoming.track }
    handoff.current = take
    if (outgoing) getProvider().scrobble?.(outgoing.id, true).catch(() => {})
    void state.next(true)
  }

  // register element
  useEffect(() => {
    ref.current = decks.current[0]
    usePlayer.setState({ audio: ref.current, isPlaying: false })
    return () => {
      usePlayer.setState({ audio: null })
    }
  }, [])

  useEffect(() => {
    usePlayer.getState().configureRecommendations(provider.getRecommendations?.bind(provider) ?? null)
    return () => usePlayer.getState().configureRecommendations(null)
  }, [provider])

  useEffect(() => {
    autoRetried.current = false
    refreshUrl.current = false
  }, [track, provider, playbackId])

  // load track
  useEffect(() => {
    ready.current = false
    failed.current = false
    if (!ref.current || !track) return
    // Auto-advance onto the deck that is already buffered (gapless) or already fading in (crossfade).
    const take = handoff.current
    handoff.current = null
    if (take && take.trackId === track.id && playbackId === take.playbackId + 1 && take.deck.getAttribute("src")) {
      const previous = ref.current
      ref.current = take.deck
      ready.current = true
      const d = take.deck.duration
      usePlayer.setState({ audio: take.deck, buffering: false, position: take.deck.currentTime, duration: isFinite(d) && d > 0 ? d : track.duration })
      if (usePlayer.getState().isPlaying && take.deck.paused) take.deck.play().catch(() => {})
      if (!fade.current) { take.deck.volume = baseVolume(track); clearDeck(previous) }
      provider.scrobble?.(track.id, false).catch(() => {})
      return
    }
    finishFade()
    armed.current = null
    clearDeck(otherDeck())
    const a = ref.current
    a.volume = baseVolume(track)
    let cancelled = false
    const controller = new AbortController()
    a.pause()
    a.removeAttribute("src")
    a.load()
    usePlayer.setState({ buffering: true, position: 0, duration: track.duration })
    const refresh = refreshUrl.current
    refreshUrl.current = false
    provider
      .streamUrl(track, controller.signal, refresh)
      .then((url) => {
        if (cancelled) return
        ready.current = true
        a.src = url
        if (usePlayer.getState().isPlaying) a.play().catch((error: DOMException) => {
          if (!cancelled && !["AbortError", "NotSupportedError"].includes(error.name)) usePlayer.getState().setPlaying(false)
        })
        provider.scrobble?.(track.id, false).catch(() => {})
      })
      .catch((e: Error) => {
        if (cancelled) return
        failed.current = true
        usePlayer.getState().setPlaying(false)
        usePlayer.setState({ buffering: false })
        toast.error(`No se pudo reproducir: ${e.message}`, { action: { label: "Reintentar", onClick: () => { refreshUrl.current = true; usePlayer.setState({ isPlaying: true }); setRetry((value) => value + 1) } } })
      })
    return () => {
      cancelled = true
      controller.abort()
    }
    // finishFade / otherDeck / baseVolume only touch refs and store snapshots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, provider, retry, playbackId])

  // play / pause
  useEffect(() => {
    const a = ref.current
    if (!a) return
    if (loadingRecommendations) return
    if (isPlaying && failed.current) { failed.current = false; refreshUrl.current = true; setRetry((value) => value + 1); return }
    if (!ready.current) return
    if (isPlaying && a.paused) a.play().catch(() => usePlayer.setState({ isPlaying: false }))
    if (!isPlaying && !a.paused) a.pause()
    if (!isPlaying) finishFade()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, loadingRecommendations])

  useEffect(() => {
    for (const d of decks.current) if (d) d.muted = muted
    if (ref.current && !fade.current) ref.current.volume = Math.min(1, volume * trackGain(track))
  }, [volume, muted, track, gainKey])

  // Preload the song that auto-advance will pick on the idle deck, shortly before the end.
  useEffect(() => {
    if (!dualDeck || !armNow || !track || !ready.current || buffering) return
    const upcoming = nextAutoTrack(queue, index, repeat)
    if (!upcoming) return
    if (armed.current?.trackId === upcoming.track.id && armed.current.playbackId === playbackId) return
    const idle = otherDeck()
    if (!idle || fade.current) return
    const controller = new AbortController()
    provider.streamUrl(upcoming.track, controller.signal).then((url) => {
      if (controller.signal.aborted) return
      idle.muted = usePlayer.getState().muted
      idle.volume = 0
      idle.preload = "auto"
      idle.src = url
      idle.load()
      armed.current = { trackId: upcoming.track.id, playbackId, deck: idle }
    }).catch(() => {})
    return () => controller.abort()
  }, [dualDeck, armNow, track, queue, index, repeat, playbackId, buffering, provider])

  // Turning gapless/crossfade off drops whatever is armed.
  useEffect(() => {
    if (dualDeck || !armed.current) return
    clearDeck(armed.current.deck)
    armed.current = null
  }, [dualDeck])

  // Loudness fallback (no ReplayGain): measure the current and the next song once, a few seconds in.
  useEffect(() => {
    if (!normalize || !track) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void measureLoudness(track, provider, controller.signal).then(() => {
        const upcoming = nextAutoTrack(usePlayer.getState().queue, usePlayer.getState().index, usePlayer.getState().repeat)
        if (upcoming && !controller.signal.aborted) return measureLoudness(upcoming.track, provider, controller.signal)
      })
    }, 4000)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [normalize, track, provider])

  useEffect(() => () => finishFade(), []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cache a small window in queue order, once current audio is ready, including
  // while paused. Revisit it on queue edits, resume and near the end of long songs.
  useEffect(() => {
    if (buffering || !ready.current || !upcoming.length || !provider.prepareTrack) return
    const controller = new AbortController()
    void prepareQueuedTracks(upcoming, provider.prepareTrack.bind(provider), controller.signal)
    return () => controller.abort()
  }, [upcoming, isPlaying, buffering, nearEnd, provider])

  useEffect(() => {
    if (!track || !isPlaying || buffering || !ready.current || ref.current?.paused || !isQueueEnd || repeat !== "off" || !provider.getRecommendations) return
    const controller = new AbortController()
    void provider.getRecommendations(track, controller.signal).then((tracks) => {
      if (controller.signal.aborted) return
      const seen = new Set(queue.map((item) => item.id))
      if (provider.prepareTrack) return prepareQueuedTracks(tracks.filter((item) => !seen.has(item.id)), provider.prepareTrack.bind(provider), controller.signal)
    }).catch(() => {})
    return () => controller.abort()
  }, [track, queue, isPlaying, buffering, isQueueEnd, repeat, nearEnd, provider])

  // Media Session metadata
  useEffect(() => {
    if (!("mediaSession" in navigator) || !track) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: mediaCover ? [{ src: mediaCover, sizes: "512x512" }] : [],
    })
  }, [track, mediaCover])

  useEffect(() => {
    if (!("mediaSession" in navigator)) return
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused"
  }, [isPlaying])

  useEffect(() => {
    if (!("mediaSession" in navigator)) return
    const ms = navigator.mediaSession
    const p = usePlayer.getState
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => p().setPlaying(true)],
      ["pause", () => p().setPlaying(false)],
      // Podcast episodes: the lock screen / headset "previous" and "next" skip back 15 s and forward 30 s.
      ["previoustrack", () => (p().current()?.podcast ? skipBy(-SKIP_BACK) : p().prev())],
      ["nexttrack", () => (p().current()?.podcast ? skipBy(SKIP_FORWARD) : void p().next())],
      ["seekbackward", (d) => p().seek((p().audio?.currentTime ?? 0) - (d.seekOffset ?? 10))],
      ["seekforward", (d) => p().seek((p().audio?.currentTime ?? 0) + (d.seekOffset ?? 10))],
      ["seekto", (d) => d.seekTime != null && p().seek(d.seekTime)],
      ["stop", () => { p().setPlaying(false); p().seek(0) }],
    ]
    for (const [action, h] of handlers) {
      try {
        ms.setActionHandler(action, h)
      } catch {
        /* unsupported action */
      }
    }
  }, [])

  /** Only the active deck drives player state; the idle one is preloading or fading out. */
  const live = (deck: HTMLAudioElement) => deck === ref.current

  const deck = (slot: 0 | 1) => (
    <audio
      key={slot}
      ref={(el) => { decks.current[slot] = el }}
      preload="auto"
      onTimeUpdate={(e) => {
        const a = e.currentTarget
        if (!live(a)) return
        usePlayer.setState({ position: a.currentTime })
        if ("mediaSession" in navigator && isFinite(a.duration) && a.duration > 0) {
          try {
            navigator.mediaSession.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: a.playbackRate })
          } catch {}
        }
        if (armed.current && useSettings.getState().crossfade > 0) startCrossfade(a)
      }}
      onDurationChange={(e) => live(e.currentTarget) && isFinite(e.currentTarget.duration) && usePlayer.setState({ duration: e.currentTarget.duration })}
      onWaiting={(e) => live(e.currentTarget) && usePlayer.setState({ buffering: true })}
      onPlaying={(e) => live(e.currentTarget) && usePlayer.setState({ buffering: false, isPlaying: true })}
      onCanPlay={(e) => live(e.currentTarget) && usePlayer.setState({ buffering: false })}
      onPause={(e) => {
        if (!(live(e.currentTarget) && ready.current && e.currentTarget.paused && !e.currentTarget.ended)) return
        // The store still says "playing": the WebView paused the element itself (audio focus lost to a call, another app, the assistant…)
        if (usePlayer.getState().isPlaying) notePause("focus", "el sistema pausó el audio (otra app, llamada o asistente)")
        usePlayer.getState().setPlaying(false)
      }}
      onEnded={(e) => {
        if (!live(e.currentTarget)) return
        ready.current = false
        const state = usePlayer.getState()
        const t = state.current()
        if (t) getProvider().scrobble?.(t.id, true).catch(() => {})
        // Gapless: the next song is already buffered on the idle deck, start it before React re-renders.
        const take = armed.current, upcoming = nextAutoTrack(state.queue, state.index, state.repeat)
        if (take && upcoming?.track.id === take.trackId) {
          armed.current = null
          take.deck.currentTime = 0
          take.deck.volume = Math.min(1, state.volume * trackGain(upcoming.track))
          take.deck.play().catch(() => {})
          handoff.current = take
        }
        void state.next(true)
      }}
      onError={(e) => {
        if (!live(e.currentTarget)) {
          if (armed.current?.deck === e.currentTarget) armed.current = null
          return
        }
        if (!ready.current) return
        ready.current = false
        if (provider.kind === "ytdlp" && !autoRetried.current) {
          autoRetried.current = true
          refreshUrl.current = true
          usePlayer.setState({ buffering: true })
          setRetry((value) => value + 1)
          return
        }
        failed.current = true
        if (usePlayer.getState().queue.length) toast.error("Error al reproducir la pista")
        usePlayer.getState().setPlaying(false)
        usePlayer.setState({ buffering: false })
      }}
    />
  )

  return (
    <>
      {deck(0)}
      {deck(1)}
    </>
  )
}
