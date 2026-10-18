/** Rough integrated loudness (LUFS-like): 400 ms blocks, absolute gate -70, relative gate -10 (BS.1770 gating, no K-weighting). */
export function integratedLoudness(channels: Float32Array[], sampleRate: number) {
  const block = Math.max(1, Math.round(sampleRate * 0.4)), hop = Math.max(1, Math.round(block / 4))
  const length = channels[0]?.length ?? 0
  const powers: number[] = []
  for (let start = 0; start + block <= length; start += hop) {
    let sum = 0
    for (const data of channels) for (let i = start; i < start + block; i += 2) sum += data[i] * data[i]
    powers.push(sum / (Math.ceil(block / 2) * channels.length))
  }
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p)
  const abs = powers.filter((p) => p > 0 && lufs(p) > -70)
  if (!abs.length) return -70
  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length
  const gate = lufs(mean(abs)) - 10
  const rel = abs.filter((p) => lufs(p) > gate)
  return lufs(mean(rel.length ? rel : abs))
}
