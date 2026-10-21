"use client"

import { useEffect, useState } from "react"
import { useProvider } from "@/lib/providers"
import type { MusicProvider } from "@/lib/types"
import { useRecentScope } from "@/lib/profile/search-sync"
import { canUseStaleData, dataCache as cache, dataKey, SEARCH_CACHE_MS } from "./data-cache"
import { useConnection } from "./offline/connection"

/** Tiny client-side data hook (static export → all fetching happens in the browser). */
export function useData<T>(key: string | null, fn: (p: MusicProvider) => Promise<T>) {
  const provider = useProvider()
  const { scope } = useRecentScope()
  const offline = useConnection((s) => s.offline)
  const [revision, setRevision] = useState(0)
  const fullKey = key ? dataKey(scope, key) : null
  const [state, setState] = useState<{ key: string | null; data?: T; error?: Error }>(() => ({
    key: fullKey,
    data: fullKey ? cache.peek<T>(fullKey) : undefined,
  }))

  useEffect(() => {
    const refresh = () => { cache.invalidate(); setRevision((value) => value + 1) }
    const clear = () => { setState({ key: null }); setRevision((value) => value + 1) }
    window.addEventListener("decibel:data-changed", refresh)
    window.addEventListener("decibel:data-cleared", clear)
    return () => {
      window.removeEventListener("decibel:data-changed", refresh)
      window.removeEventListener("decibel:data-cleared", clear)
    }
  }, [])

  useEffect(() => {
    if (!fullKey) return
    let alive = true
    setState((s) => (s.key === fullKey ? s : { key: fullKey, data: cache.peek<T>(fullKey) }))
    if (offline) { cache.invalidate(); return }
    cache.load(fullKey, () => fn(provider), key?.startsWith("search:") ? SEARCH_CACHE_MS : 0)
      .then((data) => {
        if (alive) setState({ key: fullKey, data })
      })
      .catch((error: Error) => {
        if (!alive) return
        setState((previous) => {
          const data = previous.key === fullKey ? previous.data : cache.peek<T>(fullKey)
          // Authentication, permission and deleted-item errors must still take effect.
          const keep = data !== undefined && canUseStaleData(error)
          return keep ? { key: fullKey, data } : { key: fullKey, error }
        })
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey, provider, revision, offline])

  const current = fullKey && state.key === fullKey ? state : { data: fullKey ? cache.peek<T>(fullKey) : undefined, error: undefined }
  return { data: current.data, error: current.error, loading: !!fullKey && current.data === undefined && !current.error }
}

export function clearDataCache() {
  cache.clear()
  if (typeof window !== "undefined") window.dispatchEvent(new Event("decibel:data-cleared"))
}

export function invalidateDataCache() {
  cache.invalidate()
  if (typeof window !== "undefined") window.dispatchEvent(new Event("decibel:data-changed"))
}
