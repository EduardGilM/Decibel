// Verifies a Tauri updater signature (minisign) the same way the installed apps do, before a release is published.
//   node scripts/updater-signature.mjs <file> <file.sig> <updater.key.pub>
// Tauri's .pub and .sig files are base64 of the minisign text files. Signature algorithm "ED" signs the
// BLAKE2b-512 hash of the file ("Ed": the file itself); the global signature covers signature + trusted comment.
import { createHash, createPublicKey, verify } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const lines = (b64) => Buffer.from(b64.trim(), "base64").toString("utf8").split(/\r?\n/).filter(Boolean)

/** { keyId, key } from the base64 Tauri public key (minisign: "Ed" + 8-byte key id + 32-byte Ed25519 key). */
export function parsePublicKey(pubkeyB64) {
  const raw = Buffer.from(lines(pubkeyB64).at(-1) ?? "", "base64")
  if (raw.length !== 42 || raw.toString("latin1", 0, 2) !== "Ed") throw new Error("Not a minisign public key")
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: raw.subarray(10).toString("base64url") }, format: "jwk" })
  return { keyId: raw.subarray(2, 10), key }
}

/** True only if `data` was signed by the private key of `pubkeyB64` (and the trusted comment is intact). */
export function verifyUpdaterSignature(data, signatureB64, pubkeyB64) {
  try {
    const { keyId, key } = parsePublicKey(pubkeyB64)
    const [, sigLine, trusted, globalLine] = lines(signatureB64)
    const sig = Buffer.from(sigLine ?? "", "base64")
    if (sig.length !== 74 || !trusted?.startsWith("trusted comment: ")) return false
    const alg = sig.toString("latin1", 0, 2)
    if ((alg !== "ED" && alg !== "Ed") || !sig.subarray(2, 10).equals(keyId)) return false
    const message = alg === "ED" ? createHash("blake2b512").update(data).digest() : Buffer.from(data)
    if (!verify(null, message, key, sig.subarray(10))) return false
    const comment = Buffer.from(trusted.slice("trusted comment: ".length), "utf8")
    return verify(null, Buffer.concat([sig.subarray(10), comment]), key, Buffer.from(globalLine ?? "", "base64"))
  } catch { return false }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, sig, pub] = process.argv.slice(2)
  if (!file || !sig || !pub) { console.error("usage: updater-signature.mjs <file> <file.sig> <updater.key.pub>"); process.exit(2) }
  const ok = verifyUpdaterSignature(readFileSync(file), readFileSync(sig, "utf8"), readFileSync(pub, "utf8"))
  console.log(ok ? "signature OK" : "signature INVALID")
  process.exit(ok ? 0 : 1)
}
