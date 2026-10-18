"use client"

import { useEffect, useState } from "react"
import { artworkSessionHeaders } from "@/lib/profile/session-token"

/**
 * Images cannot set Bearer headers through src; use an authenticated blob for those endpoints.
 * `fallback`: tried when `src` fails (e.g. a high-res YouTube frame that does not exist for this video).
 */
export function useAuthenticatedArtwork(src?: string, fallback?: string) {
  const authorization = artworkSessionHeaders(src).Authorization
  const [loaded, setLoaded] = useState<{ key: string; url: string }>()
  const key = `${src ?? ""}\n${fallback ?? ""}\n${authorization ?? ""}`
  useEffect(() => {
    if (!src || !authorization) return
    const controller = new AbortController()
    let objectUrl: string | undefined
    const load = async (url: string) => {
      const response = await fetch(url, { headers: { Authorization: authorization }, credentials: "include", signal: controller.signal, cache: "force-cache" })
      if (!response.ok) throw new Error("Portada no disponible")
      return response.blob()
    }
    void load(src)
      .catch((error) => { if (!fallback || fallback === src || controller.signal.aborted) throw error; return load(fallback) })
      .then((blob) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setLoaded({ key, url: objectUrl })
      }).catch(() => {})
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [src, fallback, authorization, key])
  return authorization ? loaded?.key === key ? loaded.url : undefined : src
}
