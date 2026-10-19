"use client"

import { useEffect } from "react"
import { toast } from "sonner"
import { api, ApiError, serverBase } from "@/lib/profile/api"
import { configurePlaybackRouter, playbackSnapshot, type DeviceSession, type PlaybackDevice, type PlaybackSnapshot } from "@/lib/audio/device-protocol"
import { useDevices } from "@/stores/devices"
import { usePlayer } from "@/stores/player"
import { useProfile } from "@/stores/profile"
import { useSession } from "@/stores/session"
import { useKeyboardShortcuts } from "./keyboard-shortcuts"

/** Actions that start a song: they always play on the device where they were chosen. */
const STARTS = new Set(["playList", "jumpTo"])

/** Another device's queue and position, without its volume: each device keeps its own (phones use the system's). */
function adopt(state: PlaybackSnapshot): Omit<PlaybackSnapshot, "volume" | "muted"> {
  const rest: Partial<PlaybackSnapshot> = { ...state }
  delete rest.volume
  delete rest.muted
  return rest as Omit<PlaybackSnapshot, "volume" | "muted">
}

function identity(): PlaybackDevice {
  const ua = navigator.userAgent
  const kind = /iPad|Tablet/i.test(ua) ? "tablet" : /Android|iPhone/i.test(ua) ? "phone" : "computer"
  const system = /Android/i.test(ua) ? "Android" : /iPad/i.test(ua) ? "iPad" : /iPhone/i.test(ua) ? "iPhone" : /Windows/i.test(ua) ? "Windows" : /Macintosh/i.test(ua) ? "Mac" : "Linux"
  const app = "__TAURI_INTERNALS__" in window ? "Decibel" : /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : "Safari"
  // Each open tab is an independent audio output; a duplicated tab must not share an id.
  return { id: crypto.randomUUID(), name: `${system} · ${app}`, kind }
}

/** One transport per signed-in profile. The existing player remains the source of local playback. */
export function DeviceSync() {
  useKeyboardShortcuts()
  const userId = useProfile((s) => s.user?.id)
  const status = useProfile((s) => s.status)
  const mode = useSession((s) => s.mode)
  const musicUrl = useSession((s) => s.ytdlpUrl)

  useEffect(() => {
    if (!userId || status !== "ready" || mode !== "ytdlp") return
    // A different music source cannot resolve the same queue on another device.
    if (musicUrl && new URL(musicUrl, location.origin).origin !== new URL(serverBase() || location.origin, location.origin).origin) return
    const device = identity()
    const abort = new AbortController()
    let disposed = false, applying = false, epoch = -1, ack = 0, initialized = false, polling = false
    // The other device picked in Dispositivos from here: only then do this device's controls drive it.
    let chosen: string | null = null
    let stoppedState: PlaybackSnapshot | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let lease: ReturnType<typeof setTimeout> | undefined
    let work = Promise.resolve()
    const enqueue = <T,>(job: () => Promise<T>): Promise<T> => {
      const next = work.then(() => {
        if (disposed) throw new Error("Sesión cerrada.")
        return job()
      })
      work = next.then(() => {}, () => {})
      return next
    }
    const silence = () => {
      if (useDevices.getState().localPlayback) {
        stoppedState = playbackSnapshot(usePlayer.getState())
        usePlayer.getState().audio?.pause()
        useDevices.setState({ localPlayback: false })
      }
    }
    const request = (route: string, body: object) => api<DeviceSession>(`/api/devices/${route}`, { method: "POST", body: { ...device, epoch, ...body }, signal: abort.signal })
    const receive = (response: DeviceSession, sent: number) => {
      if (disposed) return
      const local = response.activeId === device.id && !response.pendingId
      if (local && Date.now() - sent >= response.leaseMs - 1000) {
        silence()
        throw new Error("Reconectando…")
      }
      const changed = epoch !== response.epoch || !useDevices.getState().localPlayback
      epoch = response.epoch
      clearTimeout(lease)
      if (local) {
        if (changed && response.state) {
          usePlayer.setState({ ...adopt(response.state), playbackId: usePlayer.getState().playbackId + 1, buffering: false })
        }
        stoppedState = undefined
        useDevices.setState({ localPlayback: true })
        // Stop before the server can hand the output to a different device after connection loss.
        lease = setTimeout(() => {
          silence()
          usePlayer.setState({ isPlaying: false, buffering: false })
          useDevices.setState({ connected: false, error: "Sin conexión." })
        }, response.leaseMs - 1000 - (Date.now() - sent))
        applying = true
        try {
          for (const control of response.commands) {
            if (control.id <= ack) continue
            const action = usePlayer.getState()[control.action] as (...args: unknown[]) => unknown
            void action(...control.args.map((arg) => arg === null ? undefined : arg))
            ack = control.id
          }
        } finally { applying = false }
      } else {
        silence()
        if (response.state && !response.pendingId) usePlayer.setState({ ...adopt(response.state), buffering: false })
      }
      initialized = true
      useDevices.setState({ connected: true, devices: response.devices, activeId: response.activeId, pendingId: response.pendingId, error: null })
    }
    const failure = (error: unknown) => {
      if (disposed) return
      // Older servers can still play locally while waiting for their update.
      if (error instanceof ApiError && error.status === 404) {
        disposed = true
        clearTimeout(lease)
        configurePlaybackRouter(null)
        usePlayer.setState({ isPlaying: false })
        useDevices.setState(useDevices.getInitialState(), true)
        return
      }
      const message = error instanceof Error ? error.message : "Sin conexión."
      useDevices.setState({ connected: false, error: message })
      if (error instanceof ApiError && error.status === 401) {
        silence()
        void useProfile.getState().check()
      }
    }
    const heartbeat = async () => {
      if (polling || disposed) return
      clearTimeout(timer)
      polling = true
      try {
        await enqueue(async () => {
          const sent = Date.now()
          const local = useDevices.getState().localPlayback
          receive(await request("heartbeat", {
            ack,
            stopped: !local && (usePlayer.getState().audio?.paused ?? true),
            state: local ? playbackSnapshot(usePlayer.getState()) : stoppedState,
          }), sent)
        })
      } catch (error) { failure(error) }
      polling = false
      if (!disposed) timer = setTimeout(heartbeat, 1000)
    }

    /** Makes this device the output (the previous one stops first) and waits until it is, about a second. */
    const claim = async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const sent = Date.now()
          receive(await request("transfer", { target: device.id, state: playbackSnapshot(usePlayer.getState()) }), sent)
          break
        } catch (error) {
          // The output changed meanwhile: learn the new epoch and try once more.
          if (attempt > 0 || !(error instanceof ApiError) || error.status !== 409) throw error
          const sent = Date.now()
          receive(await request("heartbeat", { ack, stopped: true }), sent)
        }
      }
      for (let i = 0; i < 15 && !(useDevices.getState().activeId === device.id && useDevices.getState().localPlayback); i++) {
        await new Promise((resolve) => setTimeout(resolve, 700))
        const sent = Date.now()
        receive(await request("heartbeat", { ack, stopped: true }), sent)
      }
      chosen = null
    }

    useDevices.setState({ enabled: true, deviceId: device.id, error: null, transfer: async (target) => {
      chosen = target === device.id ? null : target
      try {
        await enqueue(async () => {
          const sent = Date.now()
          receive(await request("transfer", { target, state: useDevices.getState().localPlayback ? playbackSnapshot(usePlayer.getState()) : undefined }), sent)
        })
      } catch (error) {
        if (!disposed) {
          const message = error instanceof Error ? error.message : "No se pudo cambiar de dispositivo."
          useDevices.setState({ error: message })
          toast.error(message)
        }
      }
    } })
    configurePlaybackRouter((command) => {
      if (applying) return false
      const state = useDevices.getState()
      if (initialized && state.localPlayback && state.activeId === device.id && !state.pendingId) return false
      if (state.pendingId && state.pendingId !== device.id) { toast.error("Cambiando de dispositivo…"); return true }
      void enqueue(async () => {
        // Playback plays where it is started. Controls drive another device only when it was picked in
        // Dispositivos from here, or when it is already playing (the app shows «Sonando en …»). Choosing a song
        // always plays here, and nothing is ever moved by just opening the app. (Queued after the first heartbeat.)
        const now = useDevices.getState()
        const remote = now.activeId && now.activeId !== device.id ? now.activeId : null
        const here = !remote || STARTS.has(command.action) || (remote !== chosen && !usePlayer.getState().isPlaying)
        if (here && !(now.activeId === device.id && now.localPlayback && !now.pendingId)) await claim()
        if (useDevices.getState().activeId === device.id && useDevices.getState().localPlayback) {
          applying = true
          try { void (usePlayer.getState()[command.action] as (...args: unknown[]) => unknown)(...command.args) } finally { applying = false }
          return
        }
        if (here) throw new Error("No se pudo reproducir en este dispositivo. Vuelve a intentarlo.")
        // A command response does not renew the receiver's playback lease.
        const args = [...command.args]
        if (command.action === "seek" && typeof args[0] === "number") args[0] = Math.max(0, Math.min(args[0], usePlayer.getState().duration || 604800))
        if (command.action === "setVolume" && typeof args[0] === "number") args[0] = Math.max(0, Math.min(args[0], 1))
        await request("command", { command: { ...command, args } })
      }).catch((error) => {
        if (!disposed) toast.error(error instanceof Error ? error.message : "No se pudo enviar el control.")
      })
      return true
    })
    void heartbeat()
    const wake = () => { if (document.visibilityState === "visible") { clearTimeout(timer); void heartbeat() } }
    document.addEventListener("visibilitychange", wake)
    return () => {
      disposed = true
      abort.abort()
      clearTimeout(timer)
      clearTimeout(lease)
      document.removeEventListener("visibilitychange", wake)
      configurePlaybackRouter(null)
      usePlayer.getState().audio?.pause()
      usePlayer.setState({ isPlaying: false })
      useDevices.setState(useDevices.getInitialState(), true)
    }
  }, [userId, status, mode, musicUrl])
  return null
}
