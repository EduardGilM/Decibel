"use client"

import { nativeShareImage } from "@/components/music/native-media-bridge"
import type { MusicProvider } from "@/lib/types"
import { artworkSessionHeaders } from "@/lib/profile/session-token"
import { formatMinutes, hourRange, minutesOf, WEEKDAYS_PLURAL, type WrappedStats } from "@/lib/wrapped"

const W = 1080, H = 1920

async function loadImage(provider: MusicProvider, coverArt: string | undefined, size: number) {
  if (!coverArt) return undefined
  const urls = [...new Set([provider.coverUrl(coverArt, size), provider.coverUrl(coverArt)].filter(Boolean) as string[])]
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: artworkSessionHeaders(url), credentials: "include", cache: "force-cache" })
      if (!response.ok) continue
      return await createImageBitmap(await response.blob())
    } catch { /* next candidate */ }
  }
  return undefined
}

/** "rgb(r, g, b)" → [r, g, b]; anything else → the app's dark grey. */
function rgb(color: string | undefined): [number, number, number] {
  const m = color?.match(/(\d+)\D+(\d+)\D+(\d+)/)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [70, 70, 80]
}
const mix = ([r, g, b]: number[], [r2, g2, b2]: number[], t: number) => `rgb(${Math.round(r + (r2 - r) * t)}, ${Math.round(g + (g2 - g) * t)}, ${Math.round(b + (b2 - b) * t)})`

function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}

function roundedImage(ctx: CanvasRenderingContext2D, img: ImageBitmap | undefined, x: number, y: number, size: number, radius: number, fallback: string) {
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, size, size, radius)
  ctx.closePath()
  ctx.fillStyle = fallback
  ctx.fill()
  ctx.clip()
  if (img) {
    // cover-crop to a square
    const side = Math.min(img.width, img.height)
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, x, y, size, size)
  }
  ctx.restore()
}

/** Fine zero-mean noise (±3 levels) over the whole image: breaks gradient banding, as `Dither` does on screen. */
function dither(ctx: CanvasRenderingContext2D) {
  const image = ctx.getImageData(0, 0, W, H)
  const d = image.data
  let seed = 1234567
  for (let i = 0; i < d.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const n = ((seed >>> 24) / 255 - 0.5) * 6
    d[i] += n; d[i + 1] += n; d[i + 2] += n
  }
  ctx.putImageData(image, 0, 0)
}

/** 1080×1920 summary card (Instagram/WhatsApp story size) drawn on a canvas. */
export async function renderWrappedImage(stats: WrappedStats, provider: MusicProvider, { title, tint }: { title: string; tint?: string }) {
  const canvas = document.createElement("canvas")
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas no disponible")
  await document.fonts?.ready
  const font = getComputedStyle(document.body).fontFamily || "sans-serif"
  const base = rgb(tint), dark = [11, 11, 13]

  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, mix(base, dark, 0.15))
  bg.addColorStop(0.45, mix(base, dark, 0.62))
  bg.addColorStop(1, mix(base, dark, 0.92))
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, 380, 40, W / 2, 380, 760)
  glow.addColorStop(0, "rgba(255,255,255,0.16)")
  glow.addColorStop(1, "rgba(255,255,255,0)")
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  const top = stats.topTracks[0]
  const cover = await loadImage(provider, top?.track.coverArt, 800)

  ctx.textBaseline = "alphabetic"
  ctx.fillStyle = "rgba(255,255,255,0.72)"
  ctx.font = `600 34px ${font}`
  ctx.textAlign = "center"
  ctx.fillText("DECIBEL · TU WRAPPED", W / 2, 150)
  ctx.fillStyle = "#fff"
  ctx.font = `800 76px ${font}`
  ctx.fillText(fit(ctx, title, W - 160), W / 2, 245)

  ctx.save()
  ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 60; ctx.shadowOffsetY = 24
  roundedImage(ctx, cover, (W - 560) / 2, 320, 560, 36, mix(base, dark, 0.4))
  ctx.restore()

  // Minutes, centred under the cover
  ctx.textAlign = "center"
  ctx.fillStyle = "#fff"
  ctx.font = `800 124px ${font}`
  ctx.fillText(formatMinutes(minutesOf(stats.seconds)), W / 2, 1050)
  ctx.fillStyle = "rgba(255,255,255,0.72)"
  ctx.font = `500 38px ${font}`
  ctx.fillText(`minutos${stats.partialMinutes ? " (como mínimo)" : ""} · ${stats.listens} escuchas`, W / 2, 1110)

  // Two columns: top songs / top artists
  const colY = 1215, left = 90, right = W / 2 + 30, colW = W / 2 - 120
  const column = (x: number, heading: string, rows: string[]) => {
    ctx.textAlign = "left"
    ctx.fillStyle = "rgba(255,255,255,0.6)"
    ctx.font = `700 30px ${font}`
    ctx.fillText(heading.toUpperCase(), x, colY)
    rows.slice(0, 5).forEach((row, i) => {
      const y = colY + 70 + i * 64
      ctx.fillStyle = "rgba(255,255,255,0.55)"
      ctx.font = `700 36px ${font}`
      ctx.fillText(String(i + 1), x, y)
      ctx.fillStyle = "#fff"
      ctx.font = `600 36px ${font}`
      ctx.fillText(fit(ctx, row, colW - 50), x + 46, y)
    })
  }
  column(left, "Canciones top", stats.topTracks.map((t) => t.track.title))
  column(right, "Artistas top", stats.topArtists.map((a) => a.name))

  // Footer facts: streak / favourite moment, only the ones that exist
  const facts: [string, string][] = []
  if (stats.streak) facts.push(["Racha", `${stats.streak.longest} días`])
  if (stats.peakHour) facts.push(["Tu hora", hourRange(stats.peakHour.hour)])
  else if (stats.peakWeekday) facts.push(["Tu día", WEEKDAYS_PLURAL[stats.peakWeekday.day]])
  if (stats.genre) facts.push(["Género", stats.genre.name])
  facts.slice(0, 3).forEach(([label, value], i, all) => {
    const cx = (W / (all.length + 1)) * (i + 1)
    ctx.textAlign = "center"
    ctx.fillStyle = "rgba(255,255,255,0.6)"
    ctx.font = `700 28px ${font}`
    ctx.fillText(label.toUpperCase(), cx, 1650)
    ctx.fillStyle = "#fff"
    ctx.font = `700 44px ${font}`
    ctx.fillText(fit(ctx, value, W / (all.length + 1) + 60), cx, 1712)
  })

  ctx.textAlign = "center"
  ctx.fillStyle = "rgba(255,255,255,0.45)"
  ctx.font = `600 30px ${font}`
  ctx.fillText("Decibel", W / 2, H - 90)

  dither(ctx)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92))
  if (!blob) throw new Error("No se pudo generar la imagen")
  return blob
}

const toDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(blob)
})

/** Android share sheet (native bridge) → Web Share with files → download. */
export async function shareWrappedImage(blob: Blob, text: string): Promise<"native" | "shared" | "cancelled" | "downloaded"> {
  const name = "decibel-wrapped.jpg"
  if (typeof window !== "undefined" && window.DecibelNative?.shareImage) {
    if (nativeShareImage(await toDataUrl(blob), blob.type, text)) return "native"
  }
  const file = new File([blob], name, { type: blob.type })
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Mi Wrapped de Decibel", text })
      return "shared"
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return "cancelled"
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return "downloaded"
}
