"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Home } from "lucide-react"
import { Suspense } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { AccountMenu } from "@/components/music/top-bar"
import { TopSearch } from "@/components/music/top-search"
import { cn } from "@/lib/utils"
import { UpdateButton } from "./update-button"
import { useDesktopApp, WindowControls } from "./window-controls"

/**
 * Desktop app bar (Spotify layout): history arrows · round home + search in the centre · account.
 * In the desktop app it is also the window's title bar (no native one): empty space drags the window,
 * double click maximizes, and the caption buttons sit in the top-right corner.
 */
export function DesktopTopBar() {
  const router = useRouter()
  const pathname = usePathname()
  const home = pathname === "/"
  const app = useDesktopApp()
  return (
    <header className="hidden h-12 shrink-0 items-center gap-2 select-none md:flex" data-tauri-drag-region={app ? "deep" : undefined}>
      <div className="flex w-[72px] shrink-0 items-center justify-center gap-0.5 lg:w-40 lg:justify-start lg:pl-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 rounded-full text-muted-foreground hover:text-foreground" aria-label="Atrás" onClick={() => router.back()}><ChevronLeft /></Button>
          </TooltipTrigger>
          <TooltipContent>Atrás</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 rounded-full text-muted-foreground hover:text-foreground" aria-label="Adelante" onClick={() => router.forward()}><ChevronRight /></Button>
          </TooltipTrigger>
          <TooltipContent>Adelante</TooltipContent>
        </Tooltip>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild variant="secondary" size="icon" className={cn("size-12 shrink-0 rounded-full bg-secondary/80 [&_svg]:size-6", home ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
              <Link href="/" aria-label="Inicio" aria-current={home ? "page" : undefined}><Home className={cn(home && "fill-current")} /></Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Inicio</TooltipContent>
        </Tooltip>
        <Suspense>
          <TopSearch className="w-full max-w-[480px]" />
        </Suspense>
      </div>
      {app ? (
        <div className="flex shrink-0 items-center justify-end gap-1 lg:min-w-40">
          <UpdateButton />
          <AccountMenu />
          {/* Flush with the window's top-right corner (the shell has an 8px padding). */}
          <WindowControls className="-mt-2 -mr-2 ml-1" />
        </div>
      ) : (
        <div className="flex w-[72px] shrink-0 justify-end lg:w-40"><AccountMenu /></div>
      )}
    </header>
  )
}
