// Exports app-size PNGs from the original imagegen mark without redrawing it.
// Usage: node scripts/brand-icons.mjs
import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const directory = resolve(root, "public/brand")
const source = resolve(directory, "decibel-mark-symmetric.png")
const BG = "#0b0b0b"
await mkdir(directory, { recursive: true })
for (const size of [32, 180, 192, 512, 1024]) {
  await sharp(source).resize(size, size).flatten({ background: BG }).png().toFile(resolve(directory, `decibel-symmetric-icon-${size}.png`))
}
await sharp(source).resize(384, 384).flatten({ background: BG })
  .extend({ top: 64, bottom: 64, left: 64, right: 64, background: BG })
  .png().toFile(resolve(directory, "decibel-symmetric-maskable-512.png"))
console.log("Iconos PNG exportados desde public/brand/decibel-mark-symmetric.png")
