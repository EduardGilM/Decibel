import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { MusicError } from "./errors.mjs"

export function parsePodcastFeed(buffer, { python = process.env.YTMUSIC_PYTHON || "python3" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-B", fileURLToPath(new URL("./podcast-feed.py", import.meta.url))], { stdio: ["pipe", "pipe", "ignore"], timeout: 3000 })
    const chunks = []
    let length = 0
    child.on("error", () => reject(new MusicError("No se ha podido iniciar el lector RSS de podcasts.", 503)))
    child.stdout.on("data", (chunk) => { length += chunk.length; if (length > 12 * 1024 * 1024) child.kill(); else chunks.push(chunk) })
    child.stdin.on("error", () => {})
    child.on("close", (code) => {
      if (code !== 0) return reject(new MusicError("Feed RSS/Atom no válido o demasiado grande.", 502))
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))) } catch { reject(new MusicError("No se ha podido leer el feed.", 502)) }
    })
    child.stdin.end(buffer)
  })
}
