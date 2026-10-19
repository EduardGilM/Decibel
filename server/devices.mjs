import { MusicError } from "./errors.mjs"

const LEASE_MS = 8000
const PRESENCE_MS = 20000
const actions = new Set(["playList", "playNext", "addToQueue", "jumpTo", "removeAt", "moveQueueItem", "toggle", "setPlaying", "next", "prev", "seek", "setVolume", "toggleMute", "toggleShuffle", "cycleRepeat"])
const finite = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
const id = (value) => typeof value === "string" && /^[\w-]{8,80}$/.test(value)
const track = (value) => value && typeof value.id === "string" && typeof value.title === "string" && typeof value.artist === "string" && finite(value.duration, 0, 604800)
const tracks = (value) => Array.isArray(value) && value.length <= 1000 && value.every(track)

function snapshot(value) {
  if (!value || !tracks(value.queue) || !tracks(value.original) || !Number.isInteger(value.index) ||
    !finite(value.index, 0, Math.max(0, value.queue.length - 1)) ||
    !finite(value.position, 0, 604800) || !finite(value.duration, 0, 604800) ||
    !finite(value.volume, 0, 1) || !["off", "all", "one"].includes(value.repeat) ||
    ["isPlaying", "shuffle", "muted"].some((key) => typeof value[key] !== "boolean") ||
    (value.sourceLabel != null && (typeof value.sourceLabel !== "string" || value.sourceLabel.length > 500))) {
    throw new MusicError("Estado de reproducción no válido.", 400)
  }
  return Object.fromEntries(["queue", "original", "index", "position", "duration", "volume", "repeat", "isPlaying", "shuffle", "muted", "sourceLabel"].map((key) => [key, value[key]]))
}

function command(value) {
  if (!value || !actions.has(value.action) || !Array.isArray(value.args)) throw new MusicError("Control no válido.", 400)
  const a = value.args
  let valid = a.length === 0
  switch (value.action) {
    case "playList": valid = a.length <= 3 && tracks(a[0]) && a[0].length > 0 && (a[1] == null || Number.isInteger(a[1]) && finite(a[1], 0, a[0].length - 1)) && (a[2] == null || typeof a[2] === "string" && a[2].length <= 500); break
    case "playNext": case "addToQueue": valid = a.length === 1 && track(a[0]); break
    case "jumpTo": case "removeAt": valid = a.length === 1 && Number.isInteger(a[0]) && finite(a[0], 0, 999); break
    case "moveQueueItem": valid = a.length === 2 && a.every((v) => Number.isInteger(v) && finite(v, 0, 999)); break
    case "setPlaying": valid = a.length === 1 && typeof a[0] === "boolean"; break
    case "seek": valid = a.length === 1 && finite(a[0], 0, 604800); break
    case "setVolume": valid = a.length === 1 && finite(a[0], 0, 1); break
    case "next": valid = a.length === 0 || a.length === 1 && (a[0] == null || a[0] === false); break
  }
  if (!valid) throw new MusicError("Argumentos de control no válidos.", 400)
  return { action: value.action, args: a }
}

/** Ephemeral, profile-scoped sessions. A transfer waits for silence or the old playback lease. */
export function createDevices({ now = Date.now } = {}) {
  const sessions = new Map()
  function session(userId) {
    for (const [key, s] of sessions) {
      for (const [deviceId, device] of s.devices) if (now() - device.seen > PRESENCE_MS) s.devices.delete(deviceId)
      if (!s.devices.size) sessions.delete(key)
    }
    if (!sessions.has(userId)) sessions.set(userId, { devices: new Map(), activeId: null, pending: null, epoch: 0, state: null, commands: [], serial: 0 })
    const s = sessions.get(userId)
    if (s.pending && now() >= s.pending.until) finish(s)
    if (s.activeId && !s.devices.has(s.activeId)) {
      s.activeId = null
      s.epoch++
      s.commands = []
      if (s.state) s.state = { ...s.state, isPlaying: false }
    }
    return s
  }
  function finish(s) {
    s.activeId = s.devices.has(s.pending.target) ? s.pending.target : null
    s.pending = null
    s.epoch++
  }
  function view(s, deviceId) {
    return {
      devices: [...s.devices.values()].map(({ id, name, kind }) => ({ id, name, kind })),
      activeId: s.activeId, pendingId: s.pending?.target ?? null, epoch: s.epoch,
      state: s.state, commands: s.activeId === deviceId ? s.commands : [], leaseMs: LEASE_MS,
    }
  }
  function perform(userId, route, body) {
    if (!body || !id(body.id)) throw new MusicError("Dispositivo no válido.", 400)
    // Validate before touching the registry.
    const state = body.state === undefined ? undefined : snapshot(body.state)
    const control = route === "command" ? command(body.command) : undefined
    const s = session(userId)
    if (route === "heartbeat") {
      if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 80 || !["phone", "computer", "tablet"].includes(body.kind)) throw new MusicError("Nombre de dispositivo no válido.", 400)
      if (!s.devices.has(body.id) && s.devices.size >= 32) throw new MusicError("Demasiados dispositivos conectados.", 429)
      const first = !s.devices.size && !s.state
      const previous = s.devices.get(body.id)
      s.devices.set(body.id, { id: body.id, name: body.name.trim(), kind: body.kind, seen: now(), leaseUntil: previous?.leaseUntil ?? 0 })
      if (first) { s.activeId = body.id; s.epoch++; s.state = state ?? null }
      if (s.pending?.previous === body.id && body.stopped === true) {
        // Last position after silencing the previous device.
        if (state) s.state = state
        finish(s)
      }
      if (s.activeId === body.id) {
        if (body.epoch === s.epoch) {
          if (state) s.state = state
          if (Number.isSafeInteger(body.ack)) s.commands = s.commands.filter((c) => c.id > body.ack)
        }
        s.devices.get(body.id).leaseUntil = now() + LEASE_MS
      }
    } else {
      if (!s.devices.has(body.id)) throw new MusicError("Reconecta este dispositivo.", 409)
      if (body.epoch !== s.epoch) throw new MusicError("El dispositivo de reproducción ha cambiado. Inténtalo de nuevo.", 409)
      if (route === "transfer") {
        if (!s.devices.has(body.target)) throw new MusicError("Ese dispositivo ya no está conectado.", 404)
        if (s.pending) throw new MusicError("Espera a que termine el cambio de dispositivo.", 409)
        if (s.activeId !== body.target) {
          const previous = s.activeId
          if (previous === body.id && state) s.state = state
          if (!s.state && state) s.state = state
          s.pending = { target: body.target, previous, until: s.devices.get(previous)?.leaseUntil ?? now() }
          s.activeId = null
          s.commands = []
          s.epoch++
          if (!previous || now() >= s.pending.until) finish(s)
        }
      } else if (route === "command") {
        if (!s.activeId || s.pending) throw new MusicError("Elige un dispositivo conectado.", 409)
        if (s.commands.length >= 100) throw new MusicError("El dispositivo está tardando en responder.", 429)
        s.commands.push({ ...control, id: ++s.serial })
      } else throw new MusicError("Ruta no encontrada.", 404)
    }
    return view(s, body.id)
  }
  return {
    perform,
    async handle(req, url, json, user) {
      if (!url.pathname.startsWith("/api/devices/")) return false
      if (!user) throw new MusicError("Inicia sesión para conectar tus dispositivos.", 401)
      const route = url.pathname.slice("/api/devices/".length)
      if (req.method !== "POST" || !["heartbeat", "transfer", "command"].includes(route)) throw new MusicError("Ruta no encontrada.", 404)
      if (!req.headers["content-type"]?.startsWith("application/json")) throw new MusicError("Se requiere JSON.", 415)
      let data = "", size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > 2_000_000) throw new MusicError("La cola es demasiado grande para compartirla.", 413)
        data += chunk
      }
      let body
      try { body = JSON.parse(data) } catch { throw new MusicError("JSON no válido.", 400) }
      json(perform(user.id, route, body))
      return true
    },
  }
}
