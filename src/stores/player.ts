"use client"

import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import type { Track } from "@/lib/types"

/** Pre-rename key ("decibel-x" -> "musica-x"); read once as fallback, removed on the next write. */
const legacyKey = (key: string) => key.replace(/^decibel-/, "musica-")
export const brandStorage = createJSONStorage(() => ({
  getItem: (key: string) => localStorage.getItem(key) ?? localStorage.getItem(legacyKey(key)),
  setItem: (key: string, value: string) => { localStorage.setItem(key, value); localStorage.removeItem(legacyKey(key)) },
  removeItem: (key: string) => { localStorage.removeItem(key); localStorage.removeItem(legacyKey(key)) },
}))

export type RepeatMode = "off" | "all" | "one"
export type PlayerTab = "now" | "queue" | "lyrics"
type RecommendationLoader = (track: Track, signal: AbortSignal) => Promise<Track[]>

interface PlayerState {
  queue: Track[]
  original: Track[] // unshuffled order
  index: number
  isPlaying: boolean
  shuffle: boolean
  repeat: RepeatMode
  volume: number // 0..1
  muted: boolean
  position: number
  duration: number
  buffering: boolean
  playbackId: number // changes even when the same track is played again
  loadingRecommendations: boolean
  recommendationError: string | null
  recommendationLoader: RecommendationLoader | null
  sourceLabel?: string
  audio: HTMLAudioElement | null
  panelOpen: boolean // desktop right panel
  lyricsOpen: boolean
  fullOpen: boolean // mobile full screen player
  fullTab: PlayerTab
  current: () => Track | undefined
  playList: (tracks: Track[], start?: number, label?: string) => void
  playNext: (track: Track) => void
  addToQueue: (track: Track) => void
  jumpTo: (index: number) => void
  removeAt: (index: number) => void
  /** Drag & drop reorder; the playing song keeps playing. */
  moveQueueItem: (from: number, to: number) => void
  toggle: () => void
  setPlaying: (v: boolean) => void
  next: (auto?: boolean) => Promise<void>
  prev: () => void
  seek: (sec: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  configureRecommendations: (loader: RecommendationLoader | null) => void
  setPanelOpen: (v: boolean) => void
  setLyricsOpen: (v: boolean) => void
  setFullOpen: (v: boolean) => void
  setFullTab: (v: PlayerTab) => void
}

/**
 * Move a queue item (drag & drop). Keeps the playing song as current by tracking its new index.
 * Without shuffle, `original` mirrors the queue so turning shuffle off later keeps the user's order.
 */
export function moveInQueue(queue: Track[], original: Track[], index: number, from: number, to: number, shuffle: boolean) {
  if (from === to || !queue[from] || to < 0 || to >= queue.length) return { queue, original, index }
  const next = [...queue]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  let current = index
  if (from === index) current = to
  else if (from < index && to >= index) current = index - 1
  else if (from > index && to <= index) current = index + 1
  return { queue: next, original: shuffle ? original : next, index: current }
}

function shuffleArr<T>(a: T[]) {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => {
      let recommendationRequest: AbortController | null = null
      const cancelRecommendations = () => {
        if (!recommendationRequest) return
        recommendationRequest.abort()
        recommendationRequest = null
        set({ loadingRecommendations: false, buffering: false })
      }
      return {
        queue: [],
        original: [],
        index: 0,
        isPlaying: false,
        shuffle: false,
        repeat: "off",
        volume: 0.8,
        muted: false,
        position: 0,
        duration: 0,
        buffering: false,
        playbackId: 0,
        loadingRecommendations: false,
        recommendationError: null,
        recommendationLoader: null,
        audio: null,
        panelOpen: true,
        lyricsOpen: true,
        fullOpen: false,
        fullTab: "now",
        current: () => get().queue[get().index],

        playList: (tracks, start = 0, label) => {
          if (!tracks[start]) return
          cancelRecommendations()
          const first = tracks[start]
          let queue = tracks
          let index = start
          if (get().shuffle) {
            queue = [first, ...shuffleArr(tracks.filter((_, i) => i !== start))]
            index = 0
          }
          set({ queue, original: tracks, index, isPlaying: true, position: 0, sourceLabel: label, playbackId: get().playbackId + 1, recommendationError: null })
        },
        playNext: (track) => {
          cancelRecommendations()
          const { queue, index } = get()
          if (!queue.length) return get().playList([track])
          const q = [...queue]
          q.splice(index + 1, 0, track)
          set({ queue: q, original: [...get().original, track] })
        },
        addToQueue: (track) => {
          cancelRecommendations()
          if (!get().queue.length) return get().playList([track])
          set({ queue: [...get().queue, track], original: [...get().original, track] })
        },
        jumpTo: (index) => {
          if (!get().queue[index]) return
          cancelRecommendations()
          set({ index, isPlaying: true, position: 0, playbackId: get().playbackId + 1, recommendationError: null })
        },
        removeAt: (i) => {
          const { queue, index } = get()
          if (i === index) return
          cancelRecommendations()
          const q = queue.filter((_, k) => k !== i)
          set({ queue: q, index: i < index ? index - 1 : index })
        },
        moveQueueItem: (from, to) => {
          const { queue, original, index, shuffle } = get()
          set(moveInQueue(queue, original, index, from, to, shuffle))
        },
        toggle: () => {
          if (!get().queue.length) return
          get().setPlaying(!get().isPlaying)
        },
        setPlaying: (v) => {
          if (!v) cancelRecommendations()
          if (v && get().audio?.ended) set({ isPlaying: true, position: 0, playbackId: get().playbackId + 1 })
          else set({ isPlaying: v })
        },
        next: async (auto = false) => {
          const { queue, index, repeat, recommendationLoader, playbackId } = get()
          if (!queue.length) return
          if (auto && repeat === "one") {
            cancelRecommendations()
            set({ position: 0, isPlaying: true, playbackId: playbackId + 1 })
            return
          }
          if (index < queue.length - 1 || repeat === "all") {
            cancelRecommendations()
            set({ index: index < queue.length - 1 ? index + 1 : 0, position: 0, isPlaying: true, playbackId: playbackId + 1, recommendationError: null })
            return
          }
          const track = queue[index]
          if (repeat !== "off" || !recommendationLoader || !track?.id.startsWith("yt:")) {
            if (auto) set({ isPlaying: false, buffering: false, position: 0 })
            return
          }
          if (recommendationRequest) return
          const controller = new AbortController()
          recommendationRequest = controller
          set({ loadingRecommendations: true, buffering: true, isPlaying: true, recommendationError: null })
          const stillCurrent = () => {
            const state = get()
            return recommendationRequest === controller && !controller.signal.aborted && state.queue === queue && state.index === index &&
              state.playbackId === playbackId && state.isPlaying && state.repeat === "off" && state.recommendationLoader === recommendationLoader
          }
          try {
            const tracks = await recommendationLoader(track, controller.signal)
            if (!stillCurrent()) return
            const seen = new Set(queue.map((item) => item.id))
            const fresh = tracks.filter((item) => {
              if (!/^yt:[a-zA-Z0-9_-]{11}$/.test(item.id) || seen.has(item.id)) return false
              seen.add(item.id)
              return true
            })
            if (!fresh.length) throw new Error("YouTube no ha devuelto canciones nuevas para continuar.")
            set({ queue: [...queue, ...fresh], original: [...get().original, ...fresh], index: index + 1,
              position: 0, isPlaying: true, playbackId: playbackId + 1, sourceLabel: "Radio de YouTube" })
          } catch (error) {
            if (stillCurrent()) set({ isPlaying: false, buffering: false, recommendationError: error instanceof Error ? error.message : "No se pudieron obtener recomendaciones de YouTube." })
          } finally {
            if (recommendationRequest === controller) {
              recommendationRequest = null
              set({ loadingRecommendations: false })
            }
          }
        },
        prev: () => {
          cancelRecommendations()
          const { index, audio, queue, repeat } = get()
          if (audio && audio.currentTime > 3) {
            audio.currentTime = 0
            set({ position: 0 })
            return
          }
          if (index > 0) set({ index: index - 1, position: 0, isPlaying: true, playbackId: get().playbackId + 1 })
          else if (repeat === "all" && queue.length) set({ index: queue.length - 1, position: 0, isPlaying: true, playbackId: get().playbackId + 1 })
          else if (audio) { audio.currentTime = 0; set({ position: 0 }) }
        },
        seek: (sec) => {
          const a = get().audio
          if (a && isFinite(sec)) a.currentTime = Math.max(0, Math.min(sec, a.duration || sec))
          set({ position: sec })
        },
        setVolume: (v) => set({ volume: Math.max(0, Math.min(1, v)), muted: false }),
        toggleMute: () => set({ muted: !get().muted }),
        toggleShuffle: () => {
          cancelRecommendations()
          const { shuffle, queue, original, index } = get()
          const cur = queue[index]
          if (!shuffle) {
            const rest = shuffleArr(queue.filter((_, i) => i !== index))
            set({ shuffle: true, queue: cur ? [cur, ...rest] : rest, index: 0 })
          } else {
            const i = cur ? Math.max(0, original.findIndex((t) => t.id === cur.id)) : 0
            set({ shuffle: false, queue: original.length ? original : queue, index: i })
          }
        },
        cycleRepeat: () => {
          cancelRecommendations()
          set({ repeat: get().repeat === "off" ? "all" : get().repeat === "all" ? "one" : "off", recommendationError: null })
        },
        configureRecommendations: (loader) => {
          cancelRecommendations()
          set({ recommendationLoader: loader, recommendationError: null })
        },
        setPanelOpen: (v) => set({ panelOpen: v }),
        setLyricsOpen: (v) => set({ lyricsOpen: v }),
        setFullOpen: (v) => set({ fullOpen: v }),
        setFullTab: (v) => set({ fullTab: v }),
      }
    },
    {
      name: "decibel-player",
      storage: brandStorage,
      partialize: (s) => ({
        queue: s.queue,
        original: s.original,
        index: s.index,
        shuffle: s.shuffle,
        repeat: s.repeat,
        volume: s.volume,
        muted: s.muted,
        panelOpen: s.panelOpen,
        lyricsOpen: s.lyricsOpen,
        sourceLabel: s.sourceLabel,
      }),
    },
  ),
)

interface LikesState {
  overrides: Record<string, boolean>
  set: (id: string, v: boolean) => void
}

export const useLikes = create<LikesState>()((set) => ({
  overrides: {},
  set: (id, v) => set((s) => ({ overrides: { ...s.overrides, [id]: v } })),
}))
