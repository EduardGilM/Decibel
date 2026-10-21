import { createAccounts, createLoginLimiter, SESSION_DAYS, validateNewPassword, validateProfileUpdate, verifyPassword } from "./accounts.mjs"
import { openDb } from "./db.mjs"
import { MusicError } from "./errors.mjs"
import { createLibrary } from "./library.mjs"
import { createRequestSecurity } from "./request-security.mjs"
import { createRecentSearches } from "./recent-searches.mjs"

export const COOKIE = "decibel_session"
const PUBLIC = new Set(["/api/health", "/api/music/health", "/api/auth/login"])

function readCookie(req, name) {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) { try { return decodeURIComponent(rest.join("=")) } catch { throw new MusicError("Cookie de sesión no válida.") } }
  }
  return undefined
}

const bearer = (req) => /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1]
function setCookie(res, token, secure, maxAge = SESSION_DAYS * 86400) {
  const parts = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`]
  if (secure) parts.push("Secure")
  res.setHeader("Set-Cookie", parts.join("; "))
}

export async function readJson(req, limit = 64_000) {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new MusicError("Se requiere JSON.", 415)
  const chunks = []
  let bytes = 0
  for await (const chunk of req) { bytes += chunk.length; if (bytes > limit) throw new MusicError("Petición demasiado grande.", 413); chunks.push(chunk) }
  let value
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") } catch { throw new MusicError("JSON no válido.") }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MusicError("Se requiere un objeto JSON.")
  return value
}

/**
 * Profiles, sessions and per-profile data. `handle` answers /api/auth, /api/admin, /api/me and
 * /api/playlists; `guard` enforces a session on every other /api route (health stays public).
 */
export async function createProfileApi({ db = openDb(":memory:"), seed = true, admin = {}, now, limiter = createLoginLimiter({ now }), log = console.log, trustProxy } = {}) {
  const security = createRequestSecurity({ trustProxy })
  const accounts = createAccounts(db, { now })
  const library = createLibrary(db, { now })
  const searches = createRecentSearches(db, { now })
  if (Array.isArray(seed)) await accounts.seed(seed)
  else if (seed) {
    // First start with an empty database: one administrator; existing installs are never touched.
    const created = await accounts.bootstrapAdmin(admin)
    if (created?.password) log(`Perfil de administrador creado: «${created.user.name}», contraseña inicial: ${created.password} (se muestra solo esta vez; cámbiala en /admin).`)
    else if (created) log(`Perfil de administrador creado: «${created.user.name}» (contraseña de DECIBEL_ADMIN_PASSWORD).`)
  }

  const token = (req) => bearer(req) ?? readCookie(req, COOKIE)
  function authenticate(req, res) {
    const t = token(req)
    const session = accounts.session(t)
    if (session?.renewed && !bearer(req) && readCookie(req, COOKIE)) setCookie(res, t, security.isHttps(req))
    return session?.user ?? null
  }

  return {
    db, accounts, library,
    isPublic: (pathname) => PUBLIC.has(pathname),
    /** Throws 401 unless the request carries a valid session. */
    guard(req, res, pathname) {
      if (PUBLIC.has(pathname)) return null
      const user = authenticate(req, res)
      if (!user) throw new MusicError("Inicia sesión para continuar.", 401)
      return user
    },
    async handle(req, res, url, json) {
      const path = url.pathname
      // Liveness of the Decibel server itself (works without the YouTube extractor).
      if (path === "/api/health" && req.method === "GET") return json({ ok: true, profiles: db.prepare("SELECT COUNT(*) AS n FROM users WHERE active = 1").get().n }), true
      if (!/^\/api\/(auth|admin|me|playlists)(\/|$)/.test(path)) return false
      const method = req.method

      if (method === "POST" && path === "/api/auth/login") {
        const { username, password } = await readJson(req, 2000)
        if (typeof username !== "string" || !username.trim() || username.trim().length > 32 || typeof password !== "string" || password.length > 200) throw new MusicError("Nombre o contraseña no válidos.")
        const attempt = limiter.begin(security.clientIp(req), username)
        if (attempt.wait) { res.setHeader("Retry-After", String(attempt.wait)); throw new MusicError("Demasiados intentos. Vuelve a intentarlo más tarde.", 429) }
        let result
        try { result = await accounts.login(username, password, req.headers["user-agent"]) }
        finally { attempt.finish(!!result) }
        if (!result) throw new MusicError("Contraseña incorrecta.", 401)
        setCookie(res, result.token, security.isHttps(req))
        return json({ user: result.user, token: result.token }), true
      }

      const user = authenticate(req, res)
      if (!user) throw new MusicError("Inicia sesión para continuar.", 401)
      // Signed-in profiles need this minimal list to share playlists.
      if (method === "GET" && path === "/api/auth/profiles") {
        return json(accounts.list().filter((u) => u.active).map((u) => ({ id: u.id, name: u.username, color: u.color }))), true
      }
      const admin = () => { if (user.role !== "admin") throw new MusicError("Solo el administrador puede hacer esto.", 403) }
      const src = () => url.searchParams.get("source")
      const seg = path.split("/").slice(2).map(decodeURIComponent) // [area, ...rest]

      // ---- session ----
      if (path === "/api/auth/me" && method === "GET") {
        const weakProfiles = user.role === "admin" ? accounts.list().filter((u) => u.active && u.weak_password).map((u) => u.username) : undefined
        return json({ user, weakProfiles }), true
      }
      if (path === "/api/auth/logout" && method === "POST") { accounts.logout(token(req)); setCookie(res, "", security.isHttps(req), 0); return json({ ok: true }), true }
      if (path === "/api/auth/password" && method === "POST") {
        const { current, next } = await readJson(req, 2000)
        const row = accounts.get(user.id)
        if (!(await verifyPassword(current ?? "", row.password_hash))) throw new MusicError("La contraseña actual no es correcta.", 403)
        await accounts.setPassword(user.id, next, { keepToken: token(req) })
        return json({ user: accounts.publicUser(accounts.get(user.id)) }), true
      }

      // ---- admin ----
      if (seg[0] === "admin") {
        admin()
        const view = (u) => ({ ...accounts.publicUser(u), active: !!u.active, lastSeen: u.last_seen ?? null, createdAt: u.created_at })
        if (path === "/api/admin/users" && method === "GET") return json(accounts.list().map(view)), true
        if (path === "/api/admin/users" && method === "POST") { const { name, password, role } = await readJson(req, 2000); validateNewPassword(password, name); return json(await accounts.createUser({ username: name, password, role }), 201), true }
        if (seg[1] === "users" && seg[2] && method === "PATCH") {
          const { active, role, password } = await readJson(req, 2000)
          validateProfileUpdate({ active, role })
          await accounts.editUser(seg[2], { active, role, password }, user.id, { keepToken: seg[2] === user.id ? token(req) : undefined })
          return json(view(accounts.list().find((u) => u.id === seg[2]))), true
        }
        throw new MusicError("Ruta no encontrada.", 404)
      }

      // ---- per-profile data ----
      if (path === "/api/me/likes") {
        if (method === "GET") return json(library.likes(user.id, src())), true
        const { source, kind, id, item } = await readJson(req)
        if (method === "PUT") { library.like(user.id, source, kind, item); return json({ ok: true }), true }
        if (method === "DELETE") { library.unlike(user.id, source, kind, id); return json({ ok: true }), true }
      }
      if (path === "/api/me/revision" && method === "GET") return json({ revision: library.revision(user.id, src()) }), true
      if (path === "/api/me/history") {
        if (method === "GET") return json(library.history(user.id, src(), url.searchParams.get("limit"))), true
        if (method === "POST") { const { source, ...entry } = await readJson(req); library.addHistory(user.id, source, entry); return json({ ok: true }, 201), true }
        if (method === "DELETE") { library.clearHistory(user.id, src()); return json({ ok: true }), true }
      }
      // Recent searches (GET list; POST one search or a batch of queued operations; DELETE one or all).
      if (path === "/api/me/searches") {
        if (method === "GET") return json(searches.list(user.id, src())), true
        if (method === "POST") {
          const { source, ops, kind, item, at } = await readJson(req, 400_000)
          return json(searches.apply(user.id, source, ops ?? [{ op: "add", kind, item, at }])), true
        }
        if (method === "DELETE") {
          const { source, kind, id, at } = await readJson(req, 4000)
          return json(searches.apply(user.id, source, [id === undefined ? { op: "clear", at } : { op: "remove", kind, id, at }])), true
        }
      }
      if (path === "/api/me/settings") {
        if (method === "GET") return json(library.settings(user.id)), true
        if (method === "PUT") return json(library.saveSettings(user.id, (await readJson(req)).settings)), true
      }
      if (path === "/api/me/import" && method === "POST") {
        const { source, profileId, ...data } = await readJson(req, 8_000_000)
        // A preview may outlive its session (for example, after switching profiles in another tab).
        if (profileId !== undefined && profileId !== user.id) throw new MusicError("El perfil ha cambiado. Abre de nuevo la importación.", 409)
        return json(library.import(user.id, source, data)), true
      }

      // ---- playlists (own + shared + collaborative) ----
      if (seg[0] === "playlists") {
        const [, id, sub, subId] = seg
        if (!id) {
          if (method === "GET") return json(library.playlists(user.id, src())), true
          if (method === "POST") { const { source, name, tracks, track } = await readJson(req, 4_000_000); return json(library.createPlaylist(user.id, source, name, tracks ?? (track ? [track] : [])), 201), true }
        } else if (!sub) {
          if (method === "GET") return json(library.playlist(user.id, id)), true
          if (method === "PATCH") return json(library.updatePlaylist(user.id, id, await readJson(req))), true
          if (method === "DELETE") { library.deletePlaylist(user.id, id); return json({ ok: true }), true }
        } else if (sub === "tracks") {
          if (method === "POST" && !subId) return json(library.addTrack(user.id, id, (await readJson(req)).track)), true
          if (method === "DELETE" && subId) return json(library.removeTrack(user.id, id, subId)), true
        } else if (sub === "move" && method === "POST") {
          const { from, to } = await readJson(req); return json(library.moveTrack(user.id, id, from, to)), true
        } else if (sub === "members") {
          if (method === "PUT") { const { userId, role } = await readJson(req); return json(library.setMember(user.id, id, userId, role ?? null)), true }
          if (method === "DELETE" && subId === "me") { library.leave(user.id, id); return json({ ok: true }), true }
        }
      }
      throw new MusicError("Ruta no encontrada.", 404)
    },
  }
}
