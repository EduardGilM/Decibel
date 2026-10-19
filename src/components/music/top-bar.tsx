"use client"

import { useRouter } from "next/navigation"
import { ArrowDownCircle, History, Import, Keyboard, KeyRound, LogOut, Palette, Server, SlidersHorizontal, Users } from "lucide-react"
import type { ReactNode } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { clearDataCache } from "@/lib/use-data"
import { FIXED_SERVER, useSession } from "@/stores/session"
import { usePlayer } from "@/stores/player"
import { useMediaQuery } from "@/hooks/use-media-query"
import { ProgressiveBlur } from "@/components/layout/progressive-blur"
import { ThemePicker } from "@/components/theme/theme-picker"
import { TopSearch } from "./top-search"
import { BackButton, useNavigationMemory } from "./back-button"
import { Suspense } from "react"
import { useState } from "react"
import { useUi } from "@/stores/ui"
import { ProfileAvatar } from "@/components/profile/profile-avatar"
import { PasswordDialog } from "@/components/profile/password-dialog"
import { resetForProfile } from "@/lib/profile/sync"
import { useProfile } from "@/stores/profile"
import { glassClasses } from "@/components/ui/glass-shape"
import { cn } from "@/lib/utils"

export function AccountMenu({ className }: { className?: string }) {
  const router = useRouter()
  const mode = useSession((s) => s.mode)
  const creds = useSession((s) => s.creds)
  const logout = useSession((s) => s.logout)
  const [themes, setThemes] = useState(false)
  const profile = useProfile((s) => (s.status === "unavailable" ? null : s.user))
  const [password, setPassword] = useState(false)
  const sourceName = mode === "subsonic" ? creds?.username ?? "?" : mode === "ytdlp" ? "YouTube" : "Demo"
  const name = profile?.name ?? sourceName
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className={`size-10 shrink-0 rounded-full p-0 ${className ?? ""}`} aria-label="Cuenta">
            {profile ? (
              <ProfileAvatar name={profile.name} color={profile.color} className="size-8 text-sm" />
            ) : (
              <Avatar className="size-8">
                <AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">{name.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={cn("w-64", glassClasses.player)}>
          <DropdownMenuLabel className="truncate text-sm font-medium">{name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setThemes(true)}>
            <Palette /> Temas
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useUi.setState({ settingsOpen: true })}>
            <SlidersHorizontal /> Reproducción
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => router.push("/history/")}>
            <History /> Historial
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => router.push("/downloads/")}>
            <ArrowDownCircle /> Descargas
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useUi.setState({ shortcutsOpen: true })} className="hidden md:flex">
            <Keyboard /> Atajos de teclado
          </DropdownMenuItem>
          {profile && (
            <>
              <DropdownMenuSeparator />
              {mode === "ytdlp" && (
                <DropdownMenuItem onSelect={() => useUi.setState({ spotifyOpen: true })}>
                  <Import /> Importar de Spotify
                </DropdownMenuItem>
              )}
              {profile.role === "admin" && (
                <DropdownMenuItem onSelect={() => router.push("/admin/")}>
                  <Users /> Administrar perfiles
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => setPassword(true)}>
                <KeyRound /> Cambiar contraseña
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  resetForProfile()
                  void useProfile.getState().logout()
                }}
              >
                <LogOut /> Cerrar sesión · cambiar perfil
              </DropdownMenuItem>
              {!FIXED_SERVER && <DropdownMenuSeparator />}
            </>
          )}
          {!FIXED_SERVER && <DropdownMenuItem
            onSelect={() => {
              usePlayer.setState({ isPlaying: false, queue: [], original: [], index: 0 })
              clearDataCache()
              logout()
              router.replace("/login/")
            }}
          >
            {mode === "subsonic" && !profile ? <LogOut /> : <Server />} {mode === "subsonic" ? (profile ? "Desconectar Navidrome" : "Cerrar sesión") : "Cambiar fuente de música"}
          </DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      <ThemePicker open={themes} onOpenChange={setThemes} />
      {profile && <PasswordDialog open={password} onOpenChange={setPassword} />}
    </>
  )
}

/** Mobile sticky header with progressive blur (desktop uses DesktopTopBar in the shell).
 *  `leadingAvatar`: shows the full-width search instead of a title. No avatar on mobile: the profile panel
 *  opens by swiping from the left edge (ProfileDrawer). */
export function TopBar({ title, children, leadingAvatar, searchPlaceholder }: { title?: string; children?: ReactNode; leadingAvatar?: boolean; searchPlaceholder?: string }) {
  useNavigationMemory()
  const desktop = useMediaQuery("(min-width: 768px)")
  if (desktop) return null
  return (
    <header className={`sticky top-0 z-20 flex h-14 items-center gap-2 ${leadingAvatar ? "px-4" : "px-3"}`}>
      {/* Short fade (16px) so content at rest (e.g. the filter chips) sits below the blurred zone, not under it. */}
      <ProgressiveBlur direction="down" fade={16} tint="var(--surface)" strength={96} />
      {!leadingAvatar && <BackButton />}
      {title && !leadingAvatar && <h1 className="truncate text-lg font-semibold">{title}</h1>}
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        {leadingAvatar && (
          <Suspense>
            <TopSearch mobile className="w-full" placeholder={searchPlaceholder} />
          </Suspense>
        )}
        {children}
      </div>
    </header>
  )
}
