// Generates small royalty-free WAV loops in the browser so playback can be tested
// without any server or external asset.

const cache = new Map<string, string>()

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function rng(seed: number) {
  let a = seed || 1
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SCALES = [
  [0, 2, 4, 7, 9], // major pentatonic
  [0, 3, 5, 7, 10], // minor pentatonic
  [0, 2, 3, 5, 7, 8, 10], // aeolian
  [0, 2, 4, 5, 7, 9, 11], // ionian
]

export function generateTrackWav(seedKey: string, seconds: number): string {
  const cached = cache.get(seedKey)
  if (cached) return cached
  const rand = rng(hash(seedKey))
  const sampleRate = 22050
  const n = Math.floor(seconds * sampleRate)
  const data = new Int16Array(n)
  const scale = SCALES[Math.floor(rand() * SCALES.length)]
  const root = 45 + Math.floor(rand() * 12) // MIDI note
  const bpm = 84 + Math.floor(rand() * 50)
  const step = (60 / bpm / 2) * sampleRate // eighth notes
  const pattern = Array.from({ length: 16 }, () => scale[Math.floor(rand() * scale.length)] + 12 * Math.floor(rand() * 2))
  const bass = Array.from({ length: 4 }, () => scale[Math.floor(rand() * scale.length)])
  const freq = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

  for (let i = 0; i < n; i++) {
    const s = Math.floor(i / step)
    const pos = (i % step) / step
    const lead = freq(root + 12 + pattern[s % 16])
    const env = Math.exp(-pos * 4)
    const t = i / sampleRate
    const bassNote = freq(root - 12 + bass[Math.floor(s / 8) % 4])
    let v = 0.28 * env * Math.sin(2 * Math.PI * lead * t)
    v += 0.08 * env * Math.sin(4 * Math.PI * lead * t)
    v += 0.22 * Math.sin(2 * Math.PI * bassNote * t)
    // soft kick on beats
    if (s % 2 === 0) v += 0.35 * Math.exp(-pos * 18) * Math.sin(2 * Math.PI * (60 + 80 * Math.exp(-pos * 30)) * t)
    // fade in / out
    const fade = Math.min(1, i / (sampleRate * 0.5), (n - i) / (sampleRate * 1.5))
    data[i] = Math.max(-1, Math.min(1, v * fade)) * 32767 * 0.8
  }

  const buffer = new ArrayBuffer(44 + data.byteLength)
  const view = new DataView(buffer)
  const write = (o: number, str: string) => [...str].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)))
  write(0, "RIFF")
  view.setUint32(4, 36 + data.byteLength, true)
  write(8, "WAVE")
  write(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, "data")
  view.setUint32(40, data.byteLength, true)
  new Int16Array(buffer, 44).set(data)
  const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }))
  cache.set(seedKey, url)
  return url
}

export { hash, rng }
