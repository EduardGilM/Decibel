import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppShell } from "@/components/layout/app-shell"
import { PwaRegister } from "@/components/layout/pwa-register"
import { ProfileGate } from "@/components/profile/profile-gate"
import { AppDialogHost } from "@/components/ui/app-dialog"
import { NativeMediaBridge } from "@/components/music/native-media-bridge"
import { themeBootScript } from "@/lib/themes"
import "./globals.css"

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Decibel",
  description: "Reproductor autohospedado para Navidrome / Subsonic",
  manifest: "/manifest.webmanifest",
  applicationName: "Decibel",
  appleWebApp: { capable: true, title: "Decibel", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/brand/decibel-symmetric-icon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/brand/decibel-symmetric-icon-180.png", sizes: "180x180" }],
  },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  themeColor: "#121212",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="dark" data-theme="verde" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        {/* Last status-bar height injected by the Android shell, so the first paint already leaves room for it. */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("decibel-inset-top");if(t)document.documentElement.style.setProperty("--android-inset-top",t)}catch(e){}` }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <TooltipProvider delayDuration={400}>
          <AppShell>{children}</AppShell>
        </TooltipProvider>
        <ProfileGate />
        {/* Bottom centre, above the player bar (desktop) or the mini player + nav (mobile); one at a time, ~2 s. */}
        <Toaster theme="dark" position="bottom-center" visibleToasts={1} duration={2000} swipeDirections={["bottom"]} offset={{ bottom: "calc(env(safe-area-inset-bottom) + 100px)" }} mobileOffset={{ bottom: "calc(env(safe-area-inset-bottom) + 140px)", left: "0px", right: "0px" }} />
        <PwaRegister />
        <AppDialogHost />
        <NativeMediaBridge />
      </body>
    </html>
  )
}
