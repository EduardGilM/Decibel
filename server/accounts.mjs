import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import { MusicError } from "./errors.mjs"

const scrypt = promisify(scryptCb)
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
export const SESSION_DAYS = 365
const DAY = 86_400_000

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = await scrypt(password.normalize("NFC"), salt, 64, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`
}

export async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored).split("$")
  if (kind !== "scrypt" || !salt || !hash) return false
  const expected = Buffer.from(hash, "base64")
  const actual = await scrypt(String(password).normalize("NFC"), Buffer.from(salt, "base64"), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem })
  return timingSafeEqual(actual, expected)
}

/** A password equal to the user name (or very short) gets a gentle warning in /admin. */
export const isWeak = (password, username) => password.trim().toLowerCase() === username.trim().toLowerCase() || password.length < 6

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 4 || password.length > 200) throw new MusicError("La contraseña debe tener entre 4 y 200 caracteres.")
}

export function validateUsername(username) {
  const name = typeof username === "string" ? username.trim() : ""
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,31}$/u.test(name)) throw new MusicError("El nombre debe tener entre 1 y 32 letras, números, espacios, puntos o guiones.")
  return name
}

export function validateProfileUpdate({ active, role }) {
  if (active !== undefined && typeof active !== "boolean") throw new MusicError("El estado activo debe ser booleano.")
  if (role !== undefined && !["admin", "user"].includes(role)) throw new MusicError("Rol de perfil no válido.")
}

const tokenHash = (token) => createHash("sha256").update(token).digest("hex")
const publicUser = (row) => row && { id: row.id, name: row.username, role: row.role, color: row.color, weakPassword: !!row.weak_password }

export function createAccounts(db, { now = () => Date.now() } = {}) {
  const byName = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
  const byId = db.prepare("SELECT * FROM users WHERE id = ?")
  const PALETTE = ["#1db954", "#e8115b", "#2d46b9", "#f59b23", "#8d67ab", "#148a08", "#e13300", "#509bf5"]

  const accounts = {
    publicUser,
    async createUser({ username, password, role = "user", color }) {
      const name = validateUsername(username)
      validatePassword(password)
      if (byName.get(name)) throw new MusicError("Ya existe un perfil con ese nombre.", 409)
      const id = randomUUID()
      const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n
      db.prepare("INSERT INTO users (id, username, role, password_hash, weak_password, color, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)")
        .run(id, name, role === "admin" ? "admin" : "user", await hashPassword(password), isWeak(password, name) ? 1 : 0, color ?? PALETTE[count % PALETTE.length], now())
      return publicUser(byId.get(id))
    },
    /** Idempotent: creates the given profiles that do not exist yet (each one carries its own password). */
    async seed(profiles = []) {
      const created = []
      for (const profile of profiles) {
        if (byName.get(profile.username)) continue
        created.push(await accounts.createUser(profile))
      }
      return created
    },
    /**
     * First start only (no users at all): creates the administrator. Without a configured password a
     * random one is generated and returned so the caller can show it once; it is stored only as a hash.
     */
    async bootstrapAdmin({ username, password } = {}) {
      if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0) return null
      const generated = !password
      const secret = password || randomBytes(12).toString("base64url")
      const user = await accounts.createUser({ username: username || "admin", password: secret, role: "admin" })
      return { user, password: generated ? secret : undefined }
    },
    list: () => db.prepare("SELECT u.*, (SELECT MAX(last_seen) FROM sessions s WHERE s.user_id = u.id) AS last_seen FROM users u ORDER BY u.created_at, u.username").all(),
    get: (id) => byId.get(id),
    async login(username, password, userAgent) {
      const row = typeof username === "string" ? byName.get(username.trim()) : undefined
      // Always spend a scrypt round so timing does not reveal which names exist.
      const ok = await verifyPassword(password ?? "", row?.password_hash ?? "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA")
      if (!row || !ok || !row.active) return null
      return { user: publicUser(row), token: accounts.createSession(row.id, userAgent) }
    },
    createSession(userId, userAgent) {
      const token = randomBytes(32).toString("base64url")
      const t = now()
      db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_seen, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)")
        .run(tokenHash(token), userId, t, t, t + SESSION_DAYS * DAY, String(userAgent ?? "").slice(0, 200))
      return token
    },
    /** Sliding session: used within a year => renewed for another year (written at most once a day). */
    session(token) {
      if (!token) return null
      const hash = tokenHash(token)
      const row = db.prepare("SELECT s.*, u.username, u.role, u.color, u.weak_password, u.active, u.id AS uid FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").get(hash)
      const t = now()
      if (!row || !row.active || row.expires_at <= t) { if (row) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash); return null }
      let renewed = false
      if (t - row.last_seen > DAY) { db.prepare("UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?").run(t, t + SESSION_DAYS * DAY, hash); renewed = true }
      return { user: publicUser({ ...row, id: row.uid }), renewed }
    },
    logout: (token) => { if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token)) },
    async setPassword(userId, password, { keepToken } = {}) {
      validatePassword(password)
      const row = byId.get(userId)
      if (!row) throw new MusicError("Perfil no encontrado.", 404)
      db.prepare("UPDATE users SET password_hash = ?, weak_password = ?, password_changed_at = ? WHERE id = ?").run(await hashPassword(password), isWeak(password, row.username) ? 1 : 0, now(), userId)
      // Other devices must log in again with the new password.
      if (keepToken) db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?").run(userId, tokenHash(keepToken))
      else db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId)
    },
    update(userId, { active, role }, actor) {
      validateProfileUpdate({ active, role })
      const row = byId.get(userId)
      if (!row) throw new MusicError("Perfil no encontrado.", 404)
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n
      const losesAdmin = row.role === "admin" && row.active && (active === false || role === "user")
      if (losesAdmin && admins <= 1) throw new MusicError("Debe quedar al menos un administrador activo.", 409)
      if (userId === actor && active === false) throw new MusicError("No puedes desactivar tu propio perfil.", 409)
      if (active !== undefined) {
        db.prepare("UPDATE users SET active = ? WHERE id = ?").run(active ? 1 : 0, userId)
        if (!active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId)
      }
      if (role !== undefined) db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role === "admin" ? "admin" : "user", userId)
      return publicUser(byId.get(userId))
    },
  }
  return accounts
}

export { createLoginLimiter } from "./login-limiter.mjs"
