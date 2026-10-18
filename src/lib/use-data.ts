"use client"

import { useEffect, useState } from "react"
import { useProvider } from "@/lib/providers"
import type { MusicProvider } from "@/lib/types"

const cache = new Map<string, unknown>()

/** Tiny client-side data hook (static export → all fetching happens in the browser). */
export function useData<T>(key: string | null, fn: (p: MusicProvider) => Promise<T>) {
  const provider = useProvider()
  const [revision, setRevision] = useState(0)
  const fullKey = key ? `${provider.kind}:${key}` : null
  const [state, setState] = useState<{ key: string | null; data?: T; error?: Error }>(() => ({
    key: fullKey,
    data: fullKey ? (cache.get(fullKey) as T | undefined) : undefined,
  }))

  useEffect(() => {
    const refresh = () => { cache.clear(); setRevision((value) => value + 1) }
    window.addEventListener("decibel:data-changed", refresh)
    return () => window.removeEventListener("decibel:data-changed", refresh)
  }, [])

  useEffect(() => {
    if (!fullKey) return
    let alive = true
    setState((s) => (s.key === fullKey ? s : { key: fullKey, data: cache.get(fullKey) as T | undefined }))
    fn(provider)
      .then((data) => {
        cache.set(fullKey, data)
        if (alive) setState({ key: fullKey, data })
      })
      .catch((error: Error) => alive && setState({ key: fullKey, error }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey, provider, revision])

  const current = state.key === fullKey ? state : { data: undefined, error: undefined }
  return { data: current.data, error: current.error, loading: !current.data && !current.error }
}

export function clearDataCache() {
  cache.clear()
  if (typeof window !== "undefined") window.dispatchEvent(new Event("decibel:data-changed"))
}
