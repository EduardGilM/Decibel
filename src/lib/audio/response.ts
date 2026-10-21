/** Read a bounded, complete response. Partial files and HTTP error pages never become downloads. */
export async function readAudio(response: Response, maxBytes: number, signal: AbortSignal) {
  if (!response.ok || response.status !== 200 || response.headers.has("content-range")) throw new Error(`No se pudo descargar (${response.status}).`)
  const type = response.headers.get("content-type") ?? ""
  if (!/^(audio\/|video\/webm|video\/mp4|application\/octet-stream)/i.test(type)) throw new Error("El servidor no devolvió audio.")
  return readBlob(response, maxBytes, signal)
}

export async function readBlob(response: Response, maxBytes: number, signal: AbortSignal) {
  const type = response.headers.get("content-type") ?? "application/octet-stream"
  const expected = Number(response.headers.get("content-length"))
  const reader = response.body?.getReader()
  if (!reader) throw new Error("El audio está vacío.")
  const chunks: BlobPart[] = []
  let size = 0
  try {
    if (expected > maxBytes) throw new Error("Sin espacio para esta descarga.")
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error("Sin espacio para esta descarga.")
      chunks.push(value)
    }
    signal.throwIfAborted()
    if (!size || (expected > 0 && expected !== size)) throw new Error("La descarga está incompleta. Vuelve a intentarlo.")
    return new Blob(chunks, { type })
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
