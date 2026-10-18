/** Bounded per-peer/per-peer+name throttling, including verification already in flight. */
export function createLoginLimiter({ max = 8, perName = 5, windowMs = 10 * 60_000, maxConcurrent = 4, maxEntries = 10_000, now = Date.now } = {}) {
  const hits = new Map()
  let active = 0
  function buckets(ip, name) {
    const time = now()
    for (const [key, entry] of hits) {
      if (entry.expires > time || entry.active) break
      hits.delete(key)
    }
    const keys = [`ip:${ip}`, `pair:${JSON.stringify([ip, String(name ?? "").trim().toLowerCase()])}`]
    if (keys.filter((key) => !hits.has(key)).length + hits.size > maxEntries) return null
    return keys.map((key) => {
      let entry = hits.get(key)
      if (entry && entry.expires <= time && !entry.active) { hits.delete(key); entry = null }
      if (!entry) { entry = { n: 0, active: 0, expires: time + windowMs }; hits.set(key, entry) }
      return entry
    })
  }
  const wait = (entries) => {
    if (!entries || active >= maxConcurrent) return 1
    const blocked = entries.filter((entry, i) => entry.n + entry.active >= (i ? perName : max))
    return blocked.length ? Math.max(1, Math.ceil((Math.max(...blocked.map((e) => e.expires)) - now()) / 1000)) : 0
  }
  return {
    check: (ip, name) => wait(buckets(ip, name)),
    // Retain the public helper's legacy interface for callers that record failures explicitly.
    fail(ip, name) { buckets(ip, name)?.forEach((entry) => entry.n++) },
    success(ip, name) { const entries = buckets(ip, name); if (entries) entries[1].n = 0 },
    begin(ip, name) {
      if (active >= maxConcurrent) return { wait: 1 }
      const peer = hits.get(`ip:${ip}`)
      if (peer && (peer.expires > now() || peer.active) && peer.n + peer.active >= max) return { wait: Math.max(1, Math.ceil((peer.expires - now()) / 1000)) }
      const entries = buckets(ip, name), delay = wait(entries)
      if (delay) return { wait: delay }
      active++
      entries.forEach((entry) => entry.active++)
      let finished = false
      return { wait: 0, finish(success) {
        if (finished) return
        finished = true; active--
        entries.forEach((entry) => { entry.active--; if (!success) entry.n++ })
      } }
    },
  }
}
