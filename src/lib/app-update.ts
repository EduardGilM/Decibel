/**
 * App updates. The server that publishes them comes from the build (NEXT_PUBLIC_UPDATE_URL, or the fixed
 * Decibel server of a native build); nothing is hard-coded. Desktop apps use the Tauri updater with the
 * signed manifest at `<base>/releases/latest.json`; the Android app asks `<base>/api/app/version`.
 */
export const updateBase = () => (process.env.NEXT_PUBLIC_UPDATE_URL || process.env.NEXT_PUBLIC_DECIBEL_SERVER || "").replace(/\/+$/, "")

/** Same rule as Tauri's Android versionCode: major·1 000 000 + minor·1 000 + patch (0.1.9 → 1009). */
export function versionCode(version: string): number {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim())
  return m ? Number(m[1]) * 1_000_000 + Number(m[2]) * 1_000 + Number(m[3]) : 0
}

export interface ReleaseFile { name: string; sha256: string; size: number }
export interface AppVersionInfo { version: string; versionCode: number; date?: string | null; notes?: string; files: Partial<Record<"android" | "windows" | "linux-appimage" | "linux-deb", ReleaseFile>> }
export interface AndroidUpdate { version: string; url: string; sha256: string; size: number }

/** The APK to offer, if the server has a newer one than this build (and a well-formed entry for it). */
export function androidUpdate(info: unknown, current: string, base: string): AndroidUpdate | null {
  const data = info as AppVersionInfo | null
  const apk = data?.files?.android
  if (!data || typeof data.version !== "string" || !Number.isInteger(data.versionCode) || !apk) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.apk$/.test(apk.name) || !/^[a-f0-9]{64}$/.test(apk.sha256)) return null
  if (data.versionCode <= versionCode(current) || !/^https:\/\//.test(base)) return null
  return { version: data.version, url: `${base}/releases/${encodeURIComponent(apk.name)}?v=${apk.sha256.slice(0, 12)}`, sha256: apk.sha256, size: apk.size }
}

/** Native download status from the Android shell: "idle", "downloading:<0-100>", "verifying", "permission", "installing", "error:<message>". */
export function parseNativeStatus(raw: string | undefined | null): { state: "idle" | "downloading" | "verifying" | "permission" | "installing" | "error"; progress?: number; message?: string } {
  const [state, ...rest] = String(raw ?? "idle").split(":")
  const detail = rest.join(":")
  if (state === "downloading") return { state, progress: Math.max(0, Math.min(100, Number(detail) || 0)) }
  if (state === "error") return { state, message: detail || "No se pudo descargar la actualización." }
  if (state === "verifying" || state === "installing" || state === "permission") return { state }
  return { state: "idle" }
}

/** What the update modal shows. "permission": Android waits for «Instalar apps desconocidas» in Settings. */
export type UpdatePhase = "idle" | "downloading" | "installing" | "permission" | "error"
export interface UpdateProgress { phase: UpdatePhase; progress: number | null; message?: string }

/** Modal state for one poll of the Android shell (null = nothing to change yet). */
export function androidProgress(raw: string | undefined | null): UpdateProgress | null {
  const s = parseNativeStatus(raw)
  if (s.state === "downloading") return { phase: "downloading", progress: (s.progress ?? 0) / 100 }
  if (s.state === "verifying") return { phase: "downloading", progress: 1 }
  if (s.state === "permission") return { phase: "permission", progress: 1 }
  if (s.state === "installing") return { phase: "installing", progress: 1 }
  if (s.state === "error") return { phase: "error", progress: null, message: s.message }
  return null
}

/** The part of the Tauri updater's `Update` the app uses (so the flow can be tested with a mock). */
export interface DesktopUpdateLike {
  version: string
  downloadAndInstall: (onEvent?: (event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void>
  close?: () => Promise<void>
}

/**
 * Desktop in-place update: the Tauri updater downloads the installer, checks its minisign signature against the
 * public key built into the app (it refuses anything else), installs it and the app relaunches. Throws on error.
 */
export async function installDesktopUpdate(update: DesktopUpdateLike, relaunch: () => Promise<void>, report: (p: UpdateProgress) => void): Promise<void> {
  let total = 0, done = 0
  report({ phase: "downloading", progress: null })
  await update.downloadAndInstall((e) => {
    if (e.event === "Started") total = e.data?.contentLength ?? 0
    if (e.event === "Progress") { done += e.data?.chunkLength ?? 0; if (total) report({ phase: "downloading", progress: Math.min(1, done / total) }) }
    if (e.event === "Finished") report({ phase: "installing", progress: 1 })
  })
  report({ phase: "installing", progress: 1 })
  await relaunch()
}

/** Local calendar day (YYYY-MM-DD): «Más tarde» silences a version until the next day. */
export const dayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

/** Whether the modal must stay closed for `version` today (stored as {"version","day"} by «Más tarde»). */
export function snoozed(raw: string | null, version: string, today = dayKey()): boolean {
  try {
    const value = JSON.parse(raw ?? "null") as { version?: unknown; day?: unknown } | null
    return !!value && value.version === version && value.day === today
  } catch { return false }
}
