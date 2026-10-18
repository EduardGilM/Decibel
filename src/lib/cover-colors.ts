type RGB = [number, number, number]
export type CoverColorMode = "average" | "dominant"
export type CoverColors = Record<CoverColorMode, string>

const rgb = ([r, g, b]: RGB) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`

function hsl([r, g, b]: RGB): RGB {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const delta = max - min, lightness = (max + min) / 2
  if (!delta) return [0, 0, lightness]
  const hue = max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return [hue * 60, delta / (1 - Math.abs(2 * lightness - 1)), lightness]
}

/** Keep the average for glass surfaces; select an actual colour family for the accent. */
export function sampleCoverColors(pixels: Uint8ClampedArray): CoverColors | undefined {
  const groups = new Map<number, { sum: RGB; count: number; score: number }>()
  const total: RGB = [0, 0, 0]
  let count = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255
    if (!alpha) continue
    const color: RGB = [pixels[i], pixels[i + 1], pixels[i + 2]]
    for (let c = 0; c < 3; c++) total[c] += color[c] * alpha
    count += alpha
    const [hue, saturation, lightness] = hsl(color)
    // Black bars and white lettering must not drown out the artwork's colour.
    if (lightness < 0.08 || lightness > 0.92) continue
    const key = (saturation < 0.12 ? 24 : Math.floor(hue / 15)) * 4 + Math.floor(lightness * 4)
    const group = groups.get(key) ?? { sum: [0, 0, 0], count: 0, score: 0 }
    for (let c = 0; c < 3; c++) group.sum[c] += color[c] * alpha
    group.count += alpha
    group.score += alpha * (0.2 + 0.8 * saturation)
    groups.set(key, group)
  }
  if (!count) return undefined
  const average = rgb(total.map((v) => v / count) as RGB)
  let best: { sum: RGB; count: number; score: number } | undefined
  for (const group of groups.values()) {
    if (!best || group.score > best.score) best = group
  }
  return { average, dominant: best ? rgb(best.sum.map((v) => v / best.count) as RGB) : average }
}

function parseColor(color?: string): RGB | undefined {
  if (!color) return undefined
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color)
  if (hex) {
    const value = hex[1].length === 3 ? [...hex[1]].map((v) => v + v).join("") : hex[1]
    return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as RGB
  }
  const match = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(color)
  if (!match) return undefined
  const channels = match.slice(1).map(Number) as RGB
  return channels.every((v) => v <= 255) ? channels : undefined
}

function fromHsl(hue: number, saturation: number, lightness: number): RGB {
  const a = saturation * Math.min(lightness, 1 - lightness)
  return [0, 8, 4].map((n) => {
    const k = (n + hue / 30) % 12
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }) as RGB
}

function luminance(color: RGB) {
  const linear = color.map((v) => v / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

/** Continuous artwork hue, with readable controls, including on older WebViews. */
export function dynamicAccent(color?: string) {
  const source = parseColor(color)
  if (!source) return { primary: "rgb(184, 184, 184)", foreground: "rgb(20, 20, 20)" }
  const [hue, saturation, sourceLightness] = hsl(source)
  let lightness = Math.max(0.68, Math.min(0.78, sourceLightness))
  let primary = fromHsl(hue, Math.min(saturation, 0.85), lightness)
  // A luminance of .36 gives >7:1 against the dark button text and >4.5:1 on app surfaces.
  while (luminance(primary) < 0.36 && lightness < 0.9) {
    lightness += 0.01
    primary = fromHsl(hue, Math.min(saturation, 0.85), lightness)
  }
  return { primary: rgb(primary), foreground: "rgb(20, 20, 20)" }
}
