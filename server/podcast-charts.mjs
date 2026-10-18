import { readPodcastBody } from "./podcast-http.mjs"
import { MusicError } from "./errors.mjs"

const TTL = 6 * 60 * 60_000
const RETRY = 60_000
const SECTIONS = [
  ["all", "Más escuchados", 25],
  ["1303", "Comedia", 15],
  ["1489", "Noticias", 15],
  ["1488", "Crímenes reales", 15],
  ["1324", "Sociedad y cultura", 15],
  ["1545", "Deportes", 15],
  ["1487", "Historia", 15],
]
const unavailable = () => new MusicError("El ranking de podcasts no está disponible. Vuelve a intentarlo más tarde.", 502)

/** Public catalogue only; its cache and refresh budget are independent of search and profiles. */
export function createPodcastCharts({ request, saveShows, now = Date.now }) {
  const cache = new Map(), pending = new Map(), refreshes = []

  async function json(url, signal) {
    const response = await request(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(3500)]), headers: { Accept: "application/json" } })
    if (response.status !== 200) { response.body.destroy(); throw unavailable() }
    return JSON.parse((await readPodcastBody(response, 2 * 1024 * 1024)).toString("utf8"))
  }

  async function chart(country, [id, title, limit], signal) {
    const legacy = `https://itunes.apple.com/${country.toLowerCase()}/rss/toppodcasts/limit=${limit}${id === "all" ? "" : `/genre=${id}`}/json`
    const urls = id === "all" ? [`https://rss.marketingtools.apple.com/api/v2/${country.toLowerCase()}/podcasts/top/${limit}/podcasts.json`, legacy] : [legacy]
    for (const url of urls) {
      try {
        const { feed } = await json(url, signal)
        const entries = feed?.results ?? feed?.entry
        const list = Array.isArray(entries) ? entries : entries && typeof entries === "object" ? [entries] : []
        const ids = [...new Set(list.map((entry) => String(entry.id?.attributes?.["im:id"] ?? entry.id ?? "")).filter((value) => /^\d{1,20}$/.test(value)))].slice(0, limit)
        if (!ids.length) continue
        const updated = Date.parse(feed.updated?.label ?? feed.updated)
        return { id, title, ids, updatedAt: Number.isFinite(updated) ? updated : now() }
      } catch { /* Try the general chart's legacy endpoint, or omit this category. */ }
    }
    return null
  }

  async function refresh(country) {
    const signal = AbortSignal.timeout(8500) // Leave room for the profile client's 10 s deadline.
    const charts = (await Promise.all(SECTIONS.map((section) => chart(country, section, signal)))).filter(Boolean)
    const ids = [...new Set(charts.flatMap((section) => section.ids))]
    if (!ids.length) throw unavailable()
    const url = new URL("https://itunes.apple.com/lookup")
    url.search = new URLSearchParams({ id: ids.join(","), country, entity: "podcast", limit: "200" }).toString()
    const data = await json(url.href, signal)
    if (!Array.isArray(data.results)) throw unavailable()
    const wanted = new Set(ids)
    const rows = data.results.filter((row) => wanted.has(String(row.collectionId ?? row.trackId)))
    // saveShows uses the same fromApple/saveShow path as search, within one SQLite transaction.
    const shows = saveShows(rows)
    const byId = new Map(rows.map((row, index) => [String(row.collectionId ?? row.trackId), shows[index]]))
    const sections = charts.map(({ id, title, ids }) => {
      const seen = new Set()
      const podcasts = ids.map((key) => byId.get(key)).filter((show) => {
        if (!show || seen.has(show.id)) return false
        seen.add(show.id)
        return true
      })
      return { id, title, podcasts }
    }).filter((section) => section.podcasts.length)
    if (!sections.length) throw unavailable()
    const first = charts.find((chart) => chart.id === sections[0].id)
    return { country, source: "apple-charts", updatedAt: first.updatedAt, sections }
  }

  return async function getTop(country = "ES") {
    if (typeof country !== "string" || !/^[A-Za-z]{2}$/.test(country)) throw new MusicError("País no válido (código de dos letras).")
    country = country.toUpperCase()
    const hit = cache.get(country)
    if (hit?.expires > now() || hit?.retryAt > now()) return hit.data
    if (pending.has(country)) return pending.get(country)
    while (refreshes.length && refreshes[0] <= now() - RETRY) refreshes.shift()
    // At most two country refreshes/minute, not the searcher's 18 requests/minute.
    if (refreshes.length >= 2) {
      if (hit) return hit.data
      throw Object.assign(new MusicError("El ranking de podcasts está ocupado. Prueba dentro de un minuto.", 503), { retryAfter: Math.max(1, Math.ceil((refreshes[0] + RETRY - now()) / 1000)) })
    }
    refreshes.push(now())
    const work = refresh(country).then((data) => {
      if (!cache.has(country) && cache.size >= 32) cache.delete(cache.keys().next().value)
      cache.set(country, { data, expires: now() + TTL })
      return data
    }).catch(() => {
      if (!hit) throw unavailable()
      hit.retryAt = now() + RETRY
      return hit.data // Keep the original ranking timestamp during an Apple outage.
    }).finally(() => pending.delete(country))
    pending.set(country, work)
    return work
  }
}
