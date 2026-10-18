/**
 * Why playback paused without the user pressing pause in the app (Ajustes → «Comprobar reproducción en
 * segundo plano»). In-page causes are logged here; the Android shell keeps its own (notification,
 * MediaSession, headphones unplugged) and both lists are shown together.
 */
export type PauseCause = "user" | "focus" | "recording" | "noisy" | "system"
export interface PauseEntry { at: number; by: PauseCause; detail: string; ignored?: boolean }

const entries: PauseEntry[] = []

export function notePause(by: PauseCause, detail: string) {
  entries.push({ at: Date.now(), by, detail })
  if (entries.length > 12) entries.shift()
}

export const pauseLog = () => entries.slice()

const LABEL: Record<PauseCause, string> = { user: "tú", focus: "foco de audio", recording: "micrófono", noisy: "auriculares", system: "sistema" }

/** Latest causes first, e.g. "16:31:02 foco de audio (…)". */
export function describePauses(list: PauseEntry[], max = 3) {
  return list
    .slice()
    .sort((a, b) => b.at - a.at)
    .slice(0, max)
    .map((e) => `${new Date(e.at).toLocaleTimeString("es-ES")} ${LABEL[e.by] ?? e.by}${e.ignored ? " (ignorada)" : ""}: ${e.detail}`)
}
