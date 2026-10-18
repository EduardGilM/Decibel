"use client"

import { useEffect, useState } from "react"
import { applyAccent, DYNAMIC_ID, dynamicAccent, getTheme, THEME_EVENT } from "@/lib/themes"
import { useNowPlayingTint } from "@/lib/use-tint"

export function useThemeId() {
  const [id, setId] = useState<string>(() => getTheme())
  useEffect(() => {
    const on = (e: Event) => setId((e as CustomEvent<string>).detail)
    window.addEventListener(THEME_EVENT, on)
    return () => window.removeEventListener(THEME_EVENT, on)
  }, [])
  return id
}

/** Keeps the "Dinámico" theme in sync with the current album art. */
export function ThemeController() {
  const id = useThemeId()
  const tint = useNowPlayingTint("dominant")
  useEffect(() => {
    if (id !== DYNAMIC_ID) return
    const { primary, foreground } = dynamicAccent(tint)
    applyAccent(primary, foreground)
  }, [id, tint])
  return null
}
