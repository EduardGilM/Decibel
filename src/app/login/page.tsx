"use client"

import { useRouter } from "next/navigation"
import { Loader2, Search } from "lucide-react"
import { DecibelMark } from "@/components/brand/logo"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { makeCredentials, SubsonicProvider } from "@/lib/providers/subsonic"
import { normalizeMusicUrl, YtDlpProvider } from "@/lib/providers/ytdlp"
import { clearDataCache } from "@/lib/use-data"
import { DEFAULT_SERVER_URL, FIXED_SERVER, useSession } from "@/stores/session"

/**
 * Source picker (YouTube Music / other Decibel server / Navidrome / demo). Builds with a fixed Decibel server
 * (the APK) never render it, whatever was saved before: they go home, where the profile gate asks for
 * name + password when there is no session.
 */
export default function LoginPage() {
  return FIXED_SERVER ? <FixedServerRedirect /> : <SourcePicker />
}

function FixedServerRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace("/") }, [router])
  return <div className="h-dvh bg-background" />
}

function SourcePicker() {
  const router = useRouter()
  const servers = useSession((s) => s.servers)
  const loginSubsonic = useSession((s) => s.loginSubsonic)
  const loginDemo = useSession((s) => s.loginDemo)
  const loginYouTube = useSession((s) => s.loginYouTube)
  const ytdlpUrl = useSession((s) => s.ytdlpUrl)
  const [musicServer, setMusicServer] = useState(ytdlpUrl)
  const [musicError, setMusicError] = useState<string | null>(null)
  const [musicBusy, setMusicBusy] = useState(false)
  const [server, setServer] = useState(servers[0] ?? DEFAULT_SERVER_URL)
  const [user, setUser] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function connectYouTube() {
    setMusicError(null)
    setMusicBusy(true)
    try {
      const url = normalizeMusicUrl(musicServer)
      await new YtDlpProvider(url).ping()
      clearDataCache()
      loginYouTube(url)
      router.replace("/search/")
    } catch (err) { setMusicError((err as Error).message) }
    finally { setMusicBusy(false) }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const creds = makeCredentials(server, user.trim(), password)
      await new SubsonicProvider(creds).ping()
      clearDataCache()
      loginSubsonic(creds)
      router.replace("/")
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 pt-[max(var(--safe-top),24px)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <Card className="w-full max-w-sm gap-5 rounded-2xl">
        <CardHeader className="gap-3">
          <DecibelMark className="size-11" />
          <CardTitle className="text-2xl font-semibold">Entra en Decibel</CardTitle>
          <CardDescription>Busca canciones en YouTube Music o conecta tu biblioteca de Navidrome.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button className="h-11 w-full rounded-full" disabled={musicBusy || busy} onClick={connectYouTube}>
            {musicBusy ? <Loader2 className="animate-spin" /> : <Search />} Conectar a YouTube Music
          </Button>
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">Usar otro servidor de Decibel</summary>
            <div className="mt-3 flex flex-col gap-2">
              <Label htmlFor="music-server">URL del servidor</Label>
              <Input id="music-server" inputMode="url" autoCapitalize="none" autoCorrect="off" value={musicServer} onChange={(e) => setMusicServer(e.target.value)} placeholder="https://decibel.example.com" className="h-11" />
              <p className="text-xs">Déjalo vacío para usar este servidor. En la app nativa, indica la dirección del servidor de Decibel.</p>
            </div>
          </details>
          {musicError && <p role="alert" className="text-sm text-destructive">{musicError}</p>}
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground"><Separator className="flex-1" /> Navidrome / Subsonic <Separator className="flex-1" /></div>
        </CardContent>
        <form onSubmit={onSubmit}>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="server">Servidor</Label>
              <Input id="server" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="http://navidrome.example.lan:4533" value={server} onChange={(e) => setServer(e.target.value)} required className="h-11 text-base md:text-sm" list="known-servers" />
              <datalist id="known-servers">
                {servers.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">Dirección de Navidrome, con puerto. Ej.: http://navidrome.example.lan:4533</p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="user">Usuario</Label>
              <Input id="user" autoComplete="username" autoCapitalize="none" autoCorrect="off" value={user} onChange={(e) => setUser(e.target.value)} required className="h-11 text-base md:text-sm" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-11 text-base md:text-sm" />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </CardContent>
          <CardFooter className="mt-5 flex flex-col gap-3 border-0 bg-transparent">
            <Button type="submit" className="h-11 w-full rounded-full text-[15px]" disabled={busy || musicBusy}>
              {busy && <Loader2 className="animate-spin" />} Entrar
            </Button>
            <div className="flex w-full items-center gap-3 text-xs text-muted-foreground">
              <Separator className="flex-1" /> o <Separator className="flex-1" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full rounded-full"
              onClick={() => {
                clearDataCache()
                loginDemo()
                router.replace("/")
              }}
            >
              Probar el modo demo
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
