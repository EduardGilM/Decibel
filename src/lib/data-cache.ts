/** Cached content can bridge transport failures, never authentication or permission failures. */
export function canUseStaleData(error: unknown): boolean {
  const status = error && typeof error === "object" && "status" in error ? error.status : undefined
  return status === undefined || status === 0 || status === 429 || (typeof status === "number" && status >= 500)
}

/** Small bounded cache shared by search previews and full results. Never stores failures. */
export class DataCache {
  private entries = new Map<string, { data: unknown; at: number }>()
  private pending = new Map<string, Promise<unknown>>()
  private limit: number
  private now: () => number

  constructor(limit = 80, now = () => Date.now()) { this.limit = limit; this.now = now }

  peek<T>(key: string): T | undefined {
    return this.entries.get(key)?.data as T | undefined
  }

  load<T>(key: string, fetcher: () => Promise<T>, maxAge = 0): Promise<T> {
    const entry = this.entries.get(key)
    if (entry && this.now() - entry.at < maxAge) {
      this.entries.delete(key)
      this.entries.set(key, entry)
      return Promise.resolve(entry.data as T)
    }
    const pending = this.pending.get(key)
    if (pending) return pending as Promise<T>
    const request = Promise.resolve().then(fetcher).then((data) => {
      // Invalidating a profile or its library also invalidates requests still in flight.
      if (this.pending.get(key) === request) {
        this.entries.delete(key)
        this.entries.set(key, { data, at: this.now() })
        while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!)
      }
      return data
    }).catch((error: unknown) => {
      if (this.pending.get(key) === request && !canUseStaleData(error)) this.entries.delete(key)
      throw error
    }).finally(() => { if (this.pending.get(key) === request) this.pending.delete(key) })
    this.pending.set(key, request)
    return request
  }

  /** Revalidate without discarding the last usable answer if the server is temporarily down. */
  invalidate() {
    for (const entry of this.entries.values()) entry.at = -Infinity
    this.pending.clear()
  }

  clear() { this.entries.clear(); this.pending.clear() }
}

export const SEARCH_CACHE_MS = 5 * 60_000
export const dataKey = (scope: string, key: string) => JSON.stringify([scope, key])
export const dataCache = new DataCache()
