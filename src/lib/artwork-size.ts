/**
 * Pick an artwork URL sized for where it is painted. YouTube Music returns tiny song thumbnails
 * (=w60-h60 / =w120-h120) that were reused as-is in big places (album / playlist header, full-screen player),
 * so they looked pixelated. `size` is the caller's nominal size (CSS px of the slot, roughly); we fetch 2×
 * for dense screens, capped so the artwork proxy cache stays small.
 */
export const ARTWORK_MAX_PX = 800
export const ARTWORK_MIN_PX = 64

const GOOGLE = /(^|\.)(googleusercontent\.com|ggpht\.com)$/
const YTIMG = /^i\d?\.ytimg\.com$/
const YT_FRAME = /^\/(vi|vi_webp)\/([\w-]{11})\/(default|mqdefault|hqdefault|sddefault|maxresdefault)\.(jpg|webp)$/

export function artworkPixels(size: number) {
  return Math.min(ARTWORK_MAX_PX, Math.max(ARTWORK_MIN_PX, Math.round(size * 2)))
}

/** Same image at the right resolution; unknown hosts / formats come back unchanged. */
export function sizedArtwork(value: string, size?: number): string {
  if (!size) return value
  let url: URL
  try { url = new URL(value) } catch { return value }
  const px = artworkPixels(size)
  if (GOOGLE.test(url.hostname)) {
    // ...=w120-h120-l90-rj → =w{px}-h{px}-l90-rj ; ...=s88-c-k → =s{px}-c-k (other flags kept)
    const at = url.pathname.lastIndexOf("=")
    if (at < 0) return value
    const params = url.pathname.slice(at + 1)
    const next = /(^|-)w\d+-h\d+/.test(params)
      ? params.replace(/(^|-)w\d+-h\d+/, `$1w${px}-h${px}`)
      : /(^|-)s\d+(?=-|$)/.test(params)
        ? params.replace(/(^|-)s\d+(?=-|$)/, `$1s${px}`)
        : params
    if (next === params) return value
    url.pathname = url.pathname.slice(0, at + 1) + next
    return url.href
  }
  if (YTIMG.test(url.hostname)) {
    const frame = YT_FRAME.exec(url.pathname)
    if (!frame) return value
    // hqdefault (480×360) always exists; maxresdefault (1280×720) only for HD uploads → callers keep the original as fallback.
    url.pathname = `/vi/${frame[2]}/${px > 480 ? "maxresdefault" : "hqdefault"}.jpg`
    url.search = ""
    return url.href
  }
  return value
}
