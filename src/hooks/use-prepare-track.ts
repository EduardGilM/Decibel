"use client"

import { useCallback, useEffect, useRef } from "react"
import { useProvider } from "@/lib/providers"
import type { Track } from "@/lib/types"
import { prepareQueuedTracks } from "@/lib/prepare-queue"

/** Prepare one likely selection, without downloading audio or changing the queue. */
export function usePrepareTrack(track?: Track) {
  const provider = useProvider()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const request = useRef<AbortController | null>(null)
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    request.current?.abort()
    request.current = null
  }, [])
  const prepare = useCallback((candidate: Track, immediate = false) => {
    cancel()
    if (!provider.prepareTrack) return
    const start = () => {
      const controller = new AbortController()
      request.current = controller
      void prepareQueuedTracks([candidate], provider.prepareTrack!.bind(provider), controller.signal)
    }
    if (immediate) start()
    else timer.current = setTimeout(start, 150)
  }, [provider, cancel])

  useEffect(() => {
    if (track) prepare(track, true)
    return cancel
  }, [track, prepare, cancel])
  return { prepare, cancel }
}
