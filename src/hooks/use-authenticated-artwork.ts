"use client"

import { useEffect, useState } from "react"
import { artworkSessionHeaders } from "@/lib/profile/session-token"
import { useConnection } from "@/lib/offline/connection"

/**
 * Images cannot set Bearer headers through src; use an authenticated blob for those endpoints.
 * `fallback`: tried when `src` fails (e.g. a high-res YouTube frame that does not exist for this video).
 */
export function useAuthenticatedArtwork(src?: string, fallback?: string) {
  const authorization = artworkSessionHeaders(src).Authorization
  const offline = useConnection((s) => s.offline)
  const [loaded, setLoaded] = useState<{ key: string; url: string }>()
  const key = `${src ?? ""}\n${fallback ?? ""}\n${authorization ?? ""}`
  useEffect(() => {
    if (!src || !authorization || offline || loaded?.key === key) return
    const controller = new AbortController()
    const load = async (url: string) => {
      const response = await fetch(url, { headers: { Authorization: authorization }, credentials: "include", signal: controller.signal, cache: "force-cache" })
      if (!response.ok) throw new Error("Portada no disponible")
      return response.blob()
    }
    void load(src)
      .catch((error) => { if (!fallback || fallback === src || controller.signal.aborted) throw error; return load(fallback) })
      .then((blob) => {
        if (controller.signal.aborted) return
        setLoaded({ key, url: URL.createObjectURL(blob) })
      }).catch(() => {})
    return () => controller.abort()
  }, [src, fallback, authorization, key, offline, loaded?.key])
  // Network transitions cancel requests, never the last successfully loaded image.
  useEffect(() => () => { if (loaded) URL.revokeObjectURL(loaded.url) }, [loaded])
  return authorization ? loaded?.key === key ? loaded.url : undefined : src
}
