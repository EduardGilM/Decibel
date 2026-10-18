"use client"

import { create } from "zustand"

/** App-wide dialogs that can be opened from menus or keyboard shortcuts. */
export const useUi = create<{ shortcutsOpen: boolean; settingsOpen: boolean }>()(() => ({ shortcutsOpen: false, settingsOpen: false }))
