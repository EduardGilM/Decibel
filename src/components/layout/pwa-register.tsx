"use client"

import { useEffect } from "react"

/** Registers the offline app-shell service worker (skipped inside Tauri and in dev). */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return
    if (!("serviceWorker" in navigator)) return
    if ("__TAURI_INTERNALS__" in window) return
    navigator.serviceWorker.register("/sw.js").catch(() => {})
  }, [])
  return null
}
