/** m:ss, or h:mm:ss from one hour (podcast episodes). */
export function formatTime(sec: number) {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}` : `${m}:${s.toString().padStart(2, "0")}`
}

export function formatLong(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

export function greeting() {
  const h = new Date().getHours()
  if (h < 6) return "Buenas noches"
  if (h < 13) return "Buenos días"
  if (h < 21) return "Buenas tardes"
  return "Buenas noches"
}
