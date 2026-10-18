"use client"

import { useUi } from "@/stores/ui"
import { PlaybackSettings } from "./playback-settings"
import { ShortcutsDialog } from "./shortcuts"

/** Dialogs reachable from anywhere (account menu, keyboard). Mounted once in the shell. */
export function AppDialogs() {
  const shortcutsOpen = useUi((s) => s.shortcutsOpen)
  const settingsOpen = useUi((s) => s.settingsOpen)
  return (
    <>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={(shortcutsOpen) => useUi.setState({ shortcutsOpen })} />
      <PlaybackSettings open={settingsOpen} onOpenChange={(settingsOpen) => useUi.setState({ settingsOpen })} />
    </>
  )
}
