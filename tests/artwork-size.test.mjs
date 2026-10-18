import assert from "node:assert/strict"
import test from "node:test"
import { artworkPixels, sizedArtwork } from "../src/lib/artwork-size.ts"

const song = "https://yt3.googleusercontent.com/ZjgiqSLqxlFsFa1O3ZIS8mmYJpw1TwP47g7bx_I7fG4I7H7Ah_e7BXW09sUgTSqHhJ893ujewIMx8i4=w120-h120-s-l90-rj"

test("googleusercontent thumbnails are rewritten to the painted size, keeping the other flags", () => {
  assert.equal(sizedArtwork(song, 500), song.replace("=w120-h120-", "=w800-h800-"))
  assert.equal(sizedArtwork(song, 80), song.replace("=w120-h120-", "=w160-h160-"))
  assert.equal(sizedArtwork("https://lh3.googleusercontent.com/abc=w544-h544-l90-rj", 600), "https://lh3.googleusercontent.com/abc=w800-h800-l90-rj")
  assert.equal(sizedArtwork("https://yt3.ggpht.com/abc=s88-c-k-c0x00ffffff-no-rj", 300), "https://yt3.ggpht.com/abc=s600-c-k-c0x00ffffff-no-rj")
  assert.equal(sizedArtwork("https://lh3.googleusercontent.com/abc", 300), "https://lh3.googleusercontent.com/abc")
})

test("i.ytimg frames use hqdefault for small slots and maxresdefault for big ones", () => {
  assert.equal(sizedArtwork("https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg", 80), "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg")
  assert.equal(sizedArtwork("https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg", 500), "https://i.ytimg.com/vi/aaaaaaaaaaa/maxresdefault.jpg")
  assert.equal(sizedArtwork("https://i.ytimg.com/vi_webp/aaaaaaaaaaa/sddefault.webp?x=1", 500), "https://i.ytimg.com/vi/aaaaaaaaaaa/maxresdefault.jpg")
})

test("no size, unknown hosts and junk stay untouched; pixels are clamped", () => {
  assert.equal(sizedArtwork(song), song)
  assert.equal(sizedArtwork("https://example.com/a=w120-h120", 500), "https://example.com/a=w120-h120")
  assert.equal(sizedArtwork("not a url", 500), "not a url")
  assert.equal(artworkPixels(10), 64)
  assert.equal(artworkPixels(5000), 800)
})
