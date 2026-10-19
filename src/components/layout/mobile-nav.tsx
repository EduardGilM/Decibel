"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Library, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ProgressiveBlur } from "./progressive-blur"
import { DevicePicker } from "@/components/player/device-picker"
import { useDevices } from "@/stores/devices"

export const NAV = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/search/", label: "Buscar", icon: Search },
  { href: "/library/", label: "Tu biblioteca", icon: Library },
]

export function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/"
  return pathname.startsWith(href.replace(/\/$/, ""))
}

export function MobileNav() {
  const pathname = usePathname()
  const devicesEnabled = useDevices((s) => s.enabled)
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 md:hidden" aria-label="Navegación principal">
      <ProgressiveBlur direction="up" fade={48} />
      <div className={cn("relative grid px-2 pb-[env(safe-area-inset-bottom)]", devicesEnabled ? "grid-cols-4" : "grid-cols-3")}>
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href)
          return (
            <Button key={href} variant="ghost" asChild className={cn("h-14 flex-col gap-1 rounded-lg text-[11px] font-medium hover:bg-transparent", active ? "text-foreground" : "text-muted-foreground")}>
              <Link href={href} aria-current={active ? "page" : undefined}>
                <Icon className={cn("size-6!", active && "stroke-[2.5]")} />
                {label}
              </Link>
            </Button>
          )
        })}
        <DevicePicker variant="nav" />
      </div>
    </nav>
  )
}
