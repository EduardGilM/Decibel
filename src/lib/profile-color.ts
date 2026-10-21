export const PALETTE = ["#1db954", "#3b82f6", "#a855f7", "#ec4899", "#ef4444", "#f97316", "#eab308", "#14b8a6"]
/** The profile's own colour, or a stable one derived from its name when it has none. */
export function profileColor(name: string, color?: string) {
  if (color) return color
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return PALETTE[hash % PALETTE.length]
}
