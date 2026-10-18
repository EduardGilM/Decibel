import { Readable } from "node:stream"

export const feedUrl = "https://feeds.example/show.xml"
export const audioUrl = "https://media.example/episode.mp3"
export const imageUrl = "https://images.example/show.png"
export const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>
<title>Conversaciones</title><description><![CDATA[<p>Un podcast <b>de prueba</b></p><script>bad()</script>]]></description><language>es</language><itunes:author>Autora</itunes:author><itunes:image href="${imageUrl}"/>
<item><guid isPermaLink="false">stable-guid</guid><title>Ciencia y café</title><description><![CDATA[<p>Física &amp; astronomía</p>]]></description><pubDate>Sun, 18 Oct 2026 10:00:00 GMT</pubDate><itunes:duration>01:02:03</itunes:duration><enclosure url="${audioUrl}" type="audio/mpeg" length="36"/></item>
<item><guid>second-guid</guid><title>Una conversación anterior</title><pubDate>Sat, 17 Oct 2026 10:00:00 GMT</pubDate><enclosure url="https://media.example/second.m4a" type="audio/mp4"/><itunes:duration>90</itunes:duration></item>
<item><guid>video</guid><title>Video</title><enclosure url="https://media.example/video.mp4" type="video/mp4"/></item>
</channel></rss>`
export const appleShow = { kind: "podcast", collectionId: 123, collectionName: "Conversaciones", artistName: "Autora", feedUrl, artworkUrl600: imageUrl, collectionViewUrl: "https://podcasts.apple.com/es/podcast/id123" }
export const appleEpisode = { ...appleShow, kind: "podcast-episode", trackName: "Ciencia y café", episodeGuid: "stable-guid", episodeUrl: audioUrl, episodeContentType: "audio", trackTimeMillis: 3723000, releaseDate: "2026-10-18T10:00:00Z", description: "Física y astronomía" }
export const audio = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz")
export const remote = (body = "", { status = 200, headers = {}, url = feedUrl } = {}) => ({ status, headers, url, body: Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(body)]) })

export function fixtureRequest(calls = []) {
  return async (value, options = {}) => {
    const url = new URL(value)
    calls.push({ url: value, ...options })
    if (url.hostname === "itunes.apple.com") return remote(JSON.stringify({ results: url.searchParams.get("entity") === "podcast" ? [appleShow] : [appleEpisode] }), { headers: { "content-type": "application/json" }, url: value })
    if (value === feedUrl) return remote(rss, { headers: { etag: '"feed-v1"' } })
    if (value === imageUrl) return remote(Buffer.from([137, 80, 78, 71]), { headers: { "content-type": "image/png" }, url: value })
    if (url.hostname === "media.example") {
      if (options.headers?.Range === "bytes=999-") return remote("bad range", { status: 416, headers: { "content-type": "text/plain", "content-length": "9", "content-range": `bytes */${audio.length}` } })
      const range = options.headers?.Range === "bytes=10-19"
      const bytes = range ? audio.subarray(10, 20) : audio
      return remote(options.method === "HEAD" ? "" : bytes, { status: range ? 206 : 200, headers: { "content-type": "audio/mpeg", "content-length": String(bytes.length), "accept-ranges": "bytes", ...(range ? { "content-range": `bytes 10-19/${audio.length}` } : {}) }, url: value })
    }
    throw new Error("Unexpected fixture URL")
  }
}
