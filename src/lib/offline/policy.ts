import type { DataSource, Track } from "../types"

export const DEFAULT_LIMIT_MB = 2048
export const LIMIT_OPTIONS_MB = [512, 1024, 2048, 5120, 10240]

/** RSS episodes use a separate streaming path; this feature downloads music. */
export const canDownload = (source: DataSource | null | undefined, track?: Pick<Track, "id" | "podcast">) => !!source && !track?.podcast && !track?.id.startsWith("episode:")

/** Server and profile bound; never include credentials or temporary signed URLs. */
export function downloadScope(source: DataSource, server: string, profile: string | null = null, account = "") {
  return JSON.stringify([source, server.replace(/\/+$/, ""), profile, account])
}

export const usedBytes = (items: Record<string, { size: number }>) => Object.values(items).reduce((sum, item) => sum + item.size, 0)

/** Whether one more file of `size` bytes fits under the limit. */
export const fits = (items: Record<string, { size: number }>, size: number, limitMB: number) => usedBytes(items) + size <= limitMB * 1024 * 1024

export function formatBytes(bytes: number) {
  if (bytes === 0) return "0 KB"
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
