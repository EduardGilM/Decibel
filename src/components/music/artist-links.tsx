"use client"

import Link from "next/link"
import { Fragment } from "react"
import { hrefArtist } from "@/components/music/media-card"
import { trackArtists } from "@/lib/track-artists"
import type { Track } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * Artist names of a song; every name with a page is its own link. Only the text is a link: the click
 * does not reach the row or the player behind it (those play or open on their own click).
 */
export function ArtistLinks({ track, className, linkClassName, onNavigate }: {
  track: Pick<Track, "artist" | "artistId" | "artists">
  className?: string
  linkClassName?: string
  /** e.g. close the full-screen player before navigating. */
  onNavigate?: () => void
}) {
  const artists = trackArtists(track)
  return (
    <span className={className}>
      {artists.map((a, i) => (
        <Fragment key={`${a.id ?? a.name}-${i}`}>
          {i > 0 && ", "}
          {a.id ? (
            <Link
              href={hrefArtist(a.id)}
              onClick={(e) => { e.stopPropagation(); onNavigate?.() }}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className={cn("hover:text-foreground hover:underline", linkClassName)}
            >
              {a.name}
            </Link>
          ) : (
            a.name
          )}
        </Fragment>
      ))}
    </span>
  )
}
