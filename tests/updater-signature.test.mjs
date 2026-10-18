import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { verifyUpdaterSignature } from "../scripts/updater-signature.mjs"

// Throwaway minisign key pair made here (never the real updater key).
function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const id = randomBytes(8)
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url")
  const pub = Buffer.from(`untrusted comment: minisign public key\n${Buffer.concat([Buffer.from("Ed"), id, raw]).toString("base64")}\n`).toString("base64")
  const signFile = (data, comment = "timestamp:1\tfile:Decibel-setup.exe", prehash = true) => {
    const sig = sign(null, prehash ? createHash("blake2b512").update(data).digest() : data, privateKey)
    const global = sign(null, Buffer.concat([sig, Buffer.from(comment)]), privateKey)
    return Buffer.from(`untrusted comment: signature from tauri secret key\n${Buffer.concat([Buffer.from(prehash ? "ED" : "Ed"), id, sig]).toString("base64")}\ntrusted comment: ${comment}\n${global.toString("base64")}\n`).toString("base64")
  }
  return { pub, signFile }
}

test("a signature made with the key verifies (prehashed and legacy)", () => {
  const { pub, signFile } = keyPair()
  const data = randomBytes(4096)
  assert.equal(verifyUpdaterSignature(data, signFile(data), pub), true)
  assert.equal(verifyUpdaterSignature(data, signFile(data, "c", false), pub), true)
})

test("tampered file, other key, edited trusted comment or garbage are rejected", () => {
  const a = keyPair(), b = keyPair()
  const data = randomBytes(4096)
  const sig = a.signFile(data)
  const tampered = Buffer.from(data); tampered[100] ^= 1
  assert.equal(verifyUpdaterSignature(tampered, sig, a.pub), false)
  assert.equal(verifyUpdaterSignature(data, sig, b.pub), false)
  const text = Buffer.from(sig, "base64").toString().replace("file:Decibel-setup.exe", "file:other.exe")
  assert.equal(verifyUpdaterSignature(data, Buffer.from(text).toString("base64"), a.pub), false)
  assert.equal(verifyUpdaterSignature(data, "bm9wZQ==", a.pub), false)
  assert.equal(verifyUpdaterSignature(data, sig, "bm9wZQ=="), false)
})

test("interop: signed by the Tauri CLI with a throwaway key", { skip: !existsSync("node_modules/.bin/tauri") && "no Tauri CLI" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "decibel-sig-"))
  try {
    const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" }
    const gen = spawnSync("node_modules/.bin/tauri", ["signer", "generate", "--ci", "-p", "", "-w", join(dir, "k.key")], { env, encoding: "utf8", timeout: 60_000 })
    assert.equal(gen.status, 0, gen.stderr)
    const file = join(dir, "app.bin"); writeFileSync(file, randomBytes(10_000))
    const s = spawnSync("node_modules/.bin/tauri", ["signer", "sign", "-f", join(dir, "k.key"), "-p", "", file], { env, encoding: "utf8", timeout: 60_000 })
    assert.equal(s.status, 0, s.stderr)
    const pub = readFileSync(join(dir, "k.key.pub"), "utf8"), sig = readFileSync(`${file}.sig`, "utf8")
    assert.equal(verifyUpdaterSignature(readFileSync(file), sig, pub), true)
    assert.equal(verifyUpdaterSignature(Buffer.concat([readFileSync(file), Buffer.from("x")]), sig, pub), false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
