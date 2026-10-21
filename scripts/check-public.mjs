import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

// This is the already-public root, not a reference to a private development branch.
const PUBLIC_ROOT = "f28a36cf1bc4b732fadd8fc54d608d888effbb96"
const REVIEWED_PUBLIC_BASE = "289f826a64df64e7a66e0a600fb4c812cc7346fd"
const revision = process.argv[2] === "--revision" ? process.argv[3] : undefined
if (revision && !/^[a-f0-9]{40}$/.test(revision)) throw new Error("Expected a full commit hash.")
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
const failures = []
const roots = git("rev-list", "--max-parents=0", revision ?? "HEAD").trim().split("\n")
if (roots.length !== 1 || roots[0] !== PUBLIC_ROOT) failures.push("History is not based exclusively on the public root.")

const emails = git("log", revision ?? "HEAD", "--format=%ae%n%ce").trim().split("\n")
if (emails.some((email) => !email.endsWith("@users.noreply.github.com") && email !== "noreply@github.com")) {
  failures.push("History contains a non-noreply author/committer address. Configure a public Git identity before committing.")
}
if (failures.length) {
  console.error(failures.join("\n"))
  process.exit(1)
}

const privatePatterns = process.env.DECIBEL_PRIVACY_PATTERNS_FILE
  ? readFileSync(process.env.DECIBEL_PRIVACY_PATTERNS_FILE, "utf8").split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter((s) => s && !s.startsWith("#"))
  : []
const files = revision
  ? git("ls-tree", "-r", "-z", revision).split("\0").filter(Boolean).map((entry) => entry.replace(/^(\d+) (?:blob|commit) ([a-f0-9]+)\t/, "$1 $2 0\t"))
  : git("ls-files", "--stage", "-z").split("\0").filter(Boolean)
// Also inspect new historical blobs, including files that were added and later deleted.
const historical = git("rev-list", "--objects", revision ?? "HEAD", `^${REVIEWED_PUBLIC_BASE}`)
  .split("\n").filter((line) => /^[a-f0-9]{40} /.test(line))
if (historical.length) {
  const objects = execFileSync("git", ["cat-file", "--batch-check=%(objecttype)"], {
    input: historical.map((line) => line.slice(0, 40)).join("\n") + "\n", encoding: "utf8",
  }).trim().split("\n")
  historical.forEach((line, index) => {
    if (objects[index] === "blob") files.push(`100644 ${line.slice(0, 40)} 0\t${line.slice(41)}`)
  })
}
const forbidden = /(?:^|\/)(?:data|\.tools|backups|screenshots-private|\.screenshots)(?:\/|$)|(?:^|\/)(?:AGENTS\.md|sudo_password\.txt|cookies[^/]*\.txt|credentials[^/]*\.json|keystore\.properties|key\.properties|google-services\.json|GoogleService-Info\.plist)$|\.(?:db|sqlite3?|keystore|jks|pem|p12|key|apk|aab|ipa|tgz|log)$|(?:^|\/)docs\/(?:HANDOFF|NOTA-|AUDIT-)|(?:^|\/)deploy\/casa\//i
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
]
for (const entry of files) {
  const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(entry)
  if (!match) { failures.push("Invalid index entry."); continue }
  const [, mode, oid, stage, file] = match
  if (stage !== "0") { failures.push(`Unresolved conflict: ${file}`); continue }
  if (mode === "120000" || mode === "160000") { failures.push(`Symlink/submodule needs explicit review: ${file}`); continue }
  if (forbidden.test(file) || (/(?:^|\/)\.env(?:\.|$)/.test(file) && file !== ".env.example")) {
    failures.push(`Private/generated file must not be published: ${file}`)
    continue
  }
  const buffer = execFileSync("git", ["cat-file", "blob", oid], { maxBuffer: 32 * 1024 * 1024 })
  if (buffer.includes(0)) continue
  const text = buffer.toString("utf8")
  if (/^(?:<{7}|={7}|>{7})(?: |$)/m.test(text)) failures.push(`Conflict marker: ${file}`)
  if (secretPatterns.some((pattern) => pattern.test(text))) failures.push(`Potential credential: ${file}`)
  if (/\/home\/[a-zA-Z0-9_.-]+\//.test(text)) failures.push(`Personal machine path: ${file}`)
  if (privatePatterns.some((pattern) => text.toLowerCase().includes(pattern))) failures.push(`Private content matched local rules: ${file}`)
}
if (failures.length) {
  console.error(failures.join("\n"))
  process.exitCode = 1
} else {
  console.log(`Public history and ${files.length} ${revision ? "committed" : "staged"} files checked; no blocked content found.`)
}
