type ShortcutEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat" | "defaultPrevented" | "isComposing">

/** Resolve before touching playback: composition, text entry and browser shortcuts keep their keys. */
export function shortcutKey(event: ShortcutEvent, editing: boolean, nativeSpace = false): string | null {
  if (event.defaultPrevented || event.isComposing || editing) return null
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (key === "k" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) return event.repeat ? null : "focus-search"
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.repeat && (!key.startsWith("Arrow") || event.shiftKey)) return null
  if (event.code === "Space") return nativeSpace ? null : "Space"
  return key
}
