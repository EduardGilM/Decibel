"use client"

import { usePathname, useRouter } from "next/navigation"
import { Suspense, useEffect, useState, type ReactNode } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { AudioEngine } from "@/components/music/audio-engine"
import { DeviceSync } from "@/components/music/device-sync"
import { useDevices } from "@/stores/devices"
import { DesktopMediaBridge } from "@/components/music/desktop-media-bridge"
import { AppDialogs } from "@/components/music/app-dialogs"
import { PlaylistPicker } from "@/components/music/playlist-picker"
import { ThemeController } from "@/components/theme/theme-controller"
import { MobilePlayer } from "@/components/player/mobile-player"
import { NowPlayingPanel } from "@/components/player/now-playing-panel"
import { PlayerBar } from "@/components/player/player-bar"
import { FIXED_SERVER, useSession } from "@/stores/session"
import { usePlayer } from "@/stores/player"
import { DesktopTopBar } from "./desktop-top-bar"
import { LibraryRail } from "./library-rail"
import { MobileNav } from "./mobile-nav"
import { ProfileDrawer } from "./profile-drawer"
import { UpdateDialog } from "./update-dialog"

function useHydrated() {
  const [h, setH] = useState(false)
  useEffect(() => setH(true), [])
  return h
}

export function AppShell({ children }: { children: ReactNode }) {
  const hydrated = useHydrated()
  const pathname = usePathname()
  const router = useRouter()
  const mode = useSession((s) => s.mode)
  const isLogin = pathname.startsWith("/login")
  const hasTrack = usePlayer((s) => s.queue.length > 0)
  const localPlayback = useDevices((s) => s.localPlayback)

  useEffect(() => {
    if (hydrated && !mode && !isLogin) router.replace("/login/")
    // fixed-server build (APK): the source picker does not exist; sign-in is the profile gate
    if (hydrated && isLogin && FIXED_SERVER) router.replace("/")
  }, [hydrated, mode, isLogin, router])

  // close the full-screen player on navigation
  useEffect(() => {
    usePlayer.getState().setFullOpen(false)
  }, [pathname])

  if (!hydrated) return <div className="h-dvh bg-background" />
  if (isLogin) return FIXED_SERVER ? <div className="h-dvh bg-background" /> : <>{children}</>
  if (!mode) return <div className="h-dvh bg-background" />

  return (
    <div className="fixed inset-0 flex flex-col bg-background pt-[var(--safe-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] md:gap-2 md:p-2">
      <DeviceSync />
      {localPlayback && <AudioEngine />}
      <DesktopMediaBridge />
      <ThemeController />
      <AppDialogs />
      <PlaylistPicker />
      <DesktopTopBar />
      <div className="flex min-h-0 flex-1 md:gap-2">
        <Suspense>
          <LibraryRail />
        </Suspense>
        <main className="relative min-w-0 flex-1 overflow-hidden bg-(--surface) [--surface:var(--background)] md:rounded-2xl md:[--surface:var(--card)]">
          <ScrollArea className="h-full [&>[data-slot=scroll-area-viewport]]:overscroll-none [&>[data-slot=scroll-area-viewport]>div]:block!">
            <div className={hasTrack ? "pb-[calc(9.5rem+env(safe-area-inset-bottom))] md:pb-8" : "pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-8"}>{children}</div>
          </ScrollArea>
        </main>
        <NowPlayingPanel />
      </div>
      <PlayerBar />
      {/* mobile: two sibling layers, each with its own backdrop-filter (never nested) */}
      <MobilePlayer />
      <MobileNav />
      <ProfileDrawer />
      <UpdateDialog />
    </div>
  )
}
