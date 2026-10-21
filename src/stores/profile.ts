"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import { api, ApiError, serverBase } from "../lib/profile/api.ts"
import { brandStorage } from "./player.ts"

export interface ProfileUser {
  id: string
  name: string
  role: "admin" | "user"
  color?: string
  weakPassword?: boolean
}

export interface PublicProfile {
  id: string
  name: string
  color?: string
}

/**
 * checking: asking the server · ready: signed in · anon: server wants a login ("¿Quién escucha?")
 * offline: unreachable with a saved profile · error: unreachable without one
 * unavailable: an unconfigured legacy/dev server does not implement profiles
 */
export type ProfileStatus = "checking" | "ready" | "anon" | "offline" | "error" | "unavailable"

interface ProfileState {
  user: ProfileUser | null
  status: ProfileStatus
  weakProfiles: string[]
  check: () => Promise<void>
  login: (name: string, password: string) => Promise<ProfileUser>
  logout: () => Promise<void>
}

let checkVersion = 0

export const useProfile = create<ProfileState>()(
  persist(
    (set, get) => ({
      user: null,
      status: "checking",
      weakProfiles: [],
      check: async () => {
        const version = ++checkVersion
        // Revalidating a saved profile must not tear down its player and device session.
        if (!get().user) set({ status: "checking" })
        try {
          const { user, weakProfiles } = await api<{ user: ProfileUser; weakProfiles?: string[] }>("/api/auth/me")
          if (version !== checkVersion) return
          if (get().user && get().user!.id !== user.id) clearProfileData()
          set({ user, status: "ready", weakProfiles: weakProfiles ?? [] })
        } catch (error) {
          if (version !== checkVersion) return
          const status = error instanceof ApiError ? error.status : 0
          if (status === 401) {
            if (get().user) clearProfileData()
            set({ user: null, status: "anon", weakProfiles: [] })
          } else if ((status === 404 || status === 405) && !serverBase() && !get().user) set({ status: "unavailable" })
          else set({ status: get().user ? "offline" : "error" })
        }
      },
      login: async (name, password) => {
        ++checkVersion
        const { user } = await api<{ user: ProfileUser }>("/api/auth/login", { method: "POST", body: { username: name, password } })
        clearProfileData()
        set({ user, status: "ready" })
        if (user.role === "admin") void get().check()
        return user
      },
      logout: async () => {
        ++checkVersion
        await api("/api/auth/logout", { method: "POST" }).catch(() => {})
        clearProfileData()
        set({ user: null, status: "anon", weakProfiles: [] })
      },
    }),
    { name: "decibel-profile", storage: brandStorage, version: 1, partialize: ({ user }) => ({ user }) },
  ),
)

/** Per-profile caches on this device; dropped whenever the profile changes. */
export function clearProfileData() {
  if (typeof window === "undefined") return
  for (const key of Object.keys(window.localStorage)) if (key.startsWith("decibel-profile-cache:")) window.localStorage.removeItem(key)
  window.dispatchEvent(new Event("decibel:profile-changed"))
}
