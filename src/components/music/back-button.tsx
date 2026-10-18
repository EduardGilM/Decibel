"use client"

import { ChevronLeft } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { useEffect } from "react"
import { cn } from "@/lib/utils"

/** Main tabs have no back button (bottom nav owns them). */
const TABS = new Set(["/", "/search", "/library"])
export const isTabRoute = (pathname: string | null) => TABS.has((pathname ?? "/").replace(/\/+$/, "") || "/")

// Has the user moved inside the app since it opened? If not (deep link / fresh start) "back" goes to Inicio,
// because history.length also counts pages outside the app (about:blank, the WebView start page...).
let firstPath: string | null = null
let moved = false

/** Called by every page (TopBar) so the back button knows whether there is an in-app page behind. */
export function useNavigationMemory() {
  const pathname = usePathname()
  useEffect(() => {
    if (firstPath === null) firstPath = pathname
    else if (pathname !== firstPath) moved = true
  }, [pathname])
}

/** Round glass back button for mobile sub-pages: history back, or Inicio when the page was opened directly. */
export function BackButton({ className }: { className?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  if (isTabRoute(pathname)) return null
  return (
    <button
      type="button"
      aria-label="Volver"
      className={cn(
        "relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full text-foreground outline-none",
        "bg-[color-mix(in_oklab,var(--card)_52%,transparent)] shadow-[0_2px_10px_rgb(0_0_0/0.28)] backdrop-blur-xl backdrop-saturate-150",
        "transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onClick={() => {
        if (moved && window.history.length > 1) router.back()
        else router.replace("/")
      }}
    >
      <ChevronLeft className="size-5 -translate-x-px" strokeWidth={2.4} />
    </button>
  )
}
