const short = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" })
const long = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" })

/** "12 oct" this year, "3 mar 2024" otherwise; "Hoy" / "Ayer" for the latest ones. */
export function formatEpisodeDate(iso: string | null, now = new Date()) {
  if (!iso) return ""
  const date = new Date(iso)
  if (isNaN(date.getTime())) return ""
  const day = (d: Date) => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86_400_000)
  const diff = day(now) - day(date)
  if (diff === 0) return "Hoy"
  if (diff === 1) return "Ayer"
  return (date.getFullYear() === now.getFullYear() ? short : long).format(date).replace(".", "")
}

/** "1 h 5 min", "42 min", "<1 min". */
export function formatEpisodeLength(seconds: number) {
  if (!isFinite(seconds) || seconds <= 0) return ""
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (!h) return m ? `${m} min` : "<1 min"
  return m ? `${h} h ${m} min` : `${h} h`
}

/** "Quedan 23 min" while an episode is half-heard. */
export function formatRemaining(duration: number, position: number) {
  const left = formatEpisodeLength(Math.max(0, duration - position))
  return left ? `Quedan ${left}` : ""
}

/** RSS descriptions arrive as plain text (the server strips markup); collapse whitespace for previews. */
export const plainPreview = (text: string) => text.replace(/\s+/g, " ").trim()
