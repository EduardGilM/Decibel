"use client"

import { SpotifyImport } from "@/components/profile/spotify-import-dialog"
import { useProfile } from "@/stores/profile"
import { useSession } from "@/stores/session"
import { useUi } from "@/stores/ui"
import { PlaybackSettings } from "./playback-settings"
import { PlaylistImport } from "./playlist-import-dialog"
import { ShortcutsDialog } from "./shortcuts"

/** Dialogs reachable from anywhere (account menu, keyboard). Mounted once in the shell. */
export function AppDialogs() {
  const shortcutsOpen = useUi((s) => s.shortcutsOpen)
  const settingsOpen = useUi((s) => s.settingsOpen)
  // Spotify imports into the signed-in profile's YouTube library; keyed so a profile switch starts clean.
  const spotifyProfile = useProfile((s) => (s.status === "unavailable" ? null : s.user?.id))
  const youtube = useSession((s) => s.mode === "ytdlp")
  return (
    <>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={(shortcutsOpen) => useUi.setState({ shortcutsOpen })} />
      <PlaybackSettings open={settingsOpen} onOpenChange={(settingsOpen) => useUi.setState({ settingsOpen })} />
      {spotifyProfile && youtube && <SpotifyImport key={spotifyProfile} />}
      {spotifyProfile && youtube && <PlaylistImport key={`playlist-${spotifyProfile}`} profileId={spotifyProfile} />}
    </>
  )
}
