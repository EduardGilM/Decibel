/**
 * One identity for a song across sources: the same id, or the same title (release noise aside), the same main
 * artist and nearly the same length (±3 s). Shared by the server (playlist adds, stream fallback) and the app
 * (✓ state, playlist duplicate checks). Pure: no I/O.
 */
const fold = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
const words = (value) => fold(value).replace(/[^a-z0-9ñ]+/g, " ").trim()
/** Bracketed or " - " suffixes that name a release of the same recording, not a different song. */
const TITLE_NOISE = /^(?:(?:\d{4} )?(?:remaster(?:ed|izad[oa])?|remasterizacion)(?: \d{4})?(?: version)?|official(?: music)?(?: video| audio)?|(?:video|audio)(?: oficial| official)?|oficial|lyrics?(?: video)?|letra|live|en (?:directo|vivo)|directo|hd|hq|4k|explicit|album version|single version|radio edit|(?:feat|ft|featuring)\b.*|con .+)$/
export function songTitle(value) {
  let title = fold(value)
  for (let previous; previous !== title;) {
    previous = title
    title = title.replace(/\s*[([]([^()[\]]*)[)\]]\s*$/, (whole, inner) => TITLE_NOISE.test(words(inner)) ? "" : whole)
      .replace(/\s+-\s+([^-]+)$/, (whole, tail) => TITLE_NOISE.test(words(tail)) ? "" : whole)
      .replace(/\s+(?:feat|ft|featuring)\.?\s.*$/, "")
  }
  return words(title)
}
export const primaryArtist = (track) => words(track?.artists?.find((artist) => artist?.name)?.name ?? String(track?.artist ?? "").split(/,|&|\s(?:feat\.?|ft\.?|x|y|and)\s/i)[0])

/** Seconds of difference still counted as the same recording. */
export const SAME_SONG_SECONDS = 3

/** Same song for playlists and ✓ state: identical id, or same title + main artist + duration within ±3 s. */
export function sameTrack(a, b) {
  if (!a || !b) return false
  if (a.id && a.id === b.id) return true
  const title = songTitle(a.title), artist = primaryArtist(a)
  const da = Number(a.duration), db = Number(b.duration)
  return title !== "" && title === songTitle(b.title) && artist !== "" && artist === primaryArtist(b)
    && da > 0 && db > 0 && Math.abs(da - db) <= SAME_SONG_SECONDS
}

/** The first track of `list` that is the same song as `track`, if any. */
export function findSameTrack(list, track) {
  return (list ?? []).find((other) => sameTrack(other, track))
}

/** Count of rows that repeat an earlier song of the same list. */
export function duplicateCount(list) {
  const seen = []
  let n = 0
  for (const track of list ?? []) { if (findSameTrack(seen, track)) n++; else seen.push(track) }
  return n
}
