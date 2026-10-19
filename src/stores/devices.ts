"use client"

import { create } from "zustand"
import type { PlaybackDevice } from "../lib/audio/device-protocol"

interface DevicesState {
  enabled: boolean
  connected: boolean
  localPlayback: boolean
  deviceId: string
  devices: PlaybackDevice[]
  activeId: string | null
  pendingId: string | null
  error: string | null
  transfer: ((id: string) => Promise<void>) | null
}

export const useDevices = create<DevicesState>()(() => ({
  enabled: false, connected: false, localPlayback: true, deviceId: "",
  devices: [], activeId: null, pendingId: null, error: null, transfer: null,
}))
