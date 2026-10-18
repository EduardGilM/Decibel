import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

// node:sqlite is still flagged experimental in Node 22; keep the one-time warning out of the logs.
const emit = process.emitWarning
process.emitWarning = (warning, ...rest) => (String(warning).includes("SQLite is an experimental feature") ? undefined : emit.call(process, warning, ...rest))
const { DatabaseSync } = await import("node:sqlite")
process.emitWarning = emit

const MIGRATIONS = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
     password_hash TEXT NOT NULL,
     weak_password INTEGER NOT NULL DEFAULT 0,
     color TEXT,
     active INTEGER NOT NULL DEFAULT 1,
     created_at INTEGER NOT NULL,
     password_changed_at INTEGER
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     last_seen INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     user_agent TEXT
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE likes (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     source TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('track', 'album', 'artist')),
     item_id TEXT NOT NULL,
     item_json TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, source, kind, item_id)
   );
   CREATE TABLE history (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     source TEXT NOT NULL,
     track_id TEXT NOT NULL,
     track_json TEXT NOT NULL,
     played_at INTEGER NOT NULL,
     listened INTEGER NOT NULL DEFAULT 0,
     UNIQUE (user_id, track_id, played_at)
   );
   CREATE INDEX history_user ON history(user_id, source, played_at DESC);
   CREATE TABLE settings (
     user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     json TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE playlists (
     id TEXT PRIMARY KEY,
     owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     source TEXT NOT NULL,
     name TEXT NOT NULL,
     collaborative INTEGER NOT NULL DEFAULT 0,
     rev INTEGER NOT NULL DEFAULT 1,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX playlists_owner ON playlists(owner_id, source);
   CREATE TABLE playlist_tracks (
     playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
     position INTEGER NOT NULL,
     track_id TEXT NOT NULL,
     track_json TEXT NOT NULL,
     added_by TEXT REFERENCES users(id) ON DELETE SET NULL,
     added_at INTEGER NOT NULL,
     PRIMARY KEY (playlist_id, position)
   );
   CREATE TABLE playlist_members (
     playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
     PRIMARY KEY (playlist_id, user_id)
   );`,
  `CREATE TABLE podcast_shows (
     id TEXT PRIMARY KEY,
     feed_url TEXT NOT NULL UNIQUE,
     metadata_json TEXT NOT NULL,
     refreshed_at INTEGER NOT NULL DEFAULT 0,
     etag TEXT,
     last_modified TEXT
   );
   CREATE TABLE podcast_episodes (
     id TEXT PRIMARY KEY,
     podcast_id TEXT NOT NULL REFERENCES podcast_shows(id) ON DELETE CASCADE,
     metadata_json TEXT NOT NULL,
     published_at INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX podcast_episodes_show ON podcast_episodes(podcast_id, published_at DESC);
   CREATE TABLE podcast_progress (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     episode_id TEXT NOT NULL REFERENCES podcast_episodes(id) ON DELETE CASCADE,
     position REAL NOT NULL DEFAULT 0,
     duration REAL NOT NULL DEFAULT 0,
     completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
     revision INTEGER NOT NULL DEFAULT 1,
     updated_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, episode_id)
   );
   CREATE INDEX podcast_progress_user ON podcast_progress(user_id, updated_at DESC);`,
  `CREATE TABLE podcast_follows (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     podcast_id TEXT NOT NULL REFERENCES podcast_shows(id) ON DELETE CASCADE,
     followed_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, podcast_id)
   );
   CREATE INDEX podcast_follows_user ON podcast_follows(user_id, followed_at DESC);`,
]

/** Opens (and migrates) the profiles database. `:memory:` for tests. */
export function openDb(file) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;")
  const version = db.prepare("PRAGMA user_version").get().user_version
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN")
    try { db.exec(MIGRATIONS[i]); db.exec(`PRAGMA user_version = ${i + 1}`); db.exec("COMMIT") } catch (error) { db.exec("ROLLBACK"); throw error }
  }
  return db
}

/** Run fn inside a transaction (node:sqlite has no helper). */
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE")
  try { const result = fn(); db.exec("COMMIT"); return result } catch (error) { db.exec("ROLLBACK"); throw error }
}
