"""Small JSON bridge to the public YouTube Music catalogue. Never downloads audio."""
import json
import re
import sys
import time
from importlib.metadata import version

try:
    import requests
    from ytmusicapi import YTMusic
except ImportError:
    print(json.dumps({"error": "setup"}), file=sys.stderr)
    sys.exit(1)


class TimeoutSession(requests.Session):
    def request(self, method, url, **kwargs):
        kwargs.setdefault("timeout", 15)
        response = super().request(method, url, **kwargs)
        # YouTube answers some catalogue requests with a "Sorry... automated queries" 403 (or a 429); the
        # same request usually succeeds right away, so retry once before giving up. Read-only requests only.
        if response.status_code in (403, 429):
            time.sleep(0.3)
            response = super().request(method, url, **kwargs)
        return response


def main():
    operation, value = sys.argv[1:3]
    if operation == "health":
        return {"name": "ytmusicapi", "version": version("ytmusicapi")}
    if operation == "artistSongs" and not re.fullmatch(r"[a-zA-Z0-9_-]{10,200}", value):
        raise ValueError("Invalid catalogue playlist ID")
    with TimeoutSession() as session:
        music = YTMusic(requests_session=session, language="en", location="ES")
        if operation == "home":
            return music.get_home(limit=3)
        if operation == "search":
            return music.search(value, filter="songs", limit=20)[:20]
        if operation == "searchAlbums":
            return music.search(value, filter="albums", limit=20)[:20]
        if operation == "searchArtists":
            return music.search(value, filter="artists", limit=20)[:20]
        if operation == "artistRadio":
            return music.get_watch_playlist(playlistId=value, limit=50)
        if operation == "artistSongs":
            return {"tracks": music.get_playlist(value, limit=100).get("tracks", [])[:100]}
        if operation == "recommendations":
            return music.get_watch_playlist(videoId=value, radio=True, limit=25)
        if operation == "album":
            return music.get_album(value)
        if operation == "artist":
            return music.get_artist(value)
        if operation == "song":
            # The watch list has album/artist IDs that the player endpoint lacks.
            try:
                playlist = music.get_watch_playlist(videoId=value, limit=1)
            except Exception:
                playlist = {}
            song = next((item for item in playlist.get("tracks", []) if item.get("videoId") == value), None)
            if song:
                return song
            details = music.get_song(value).get("videoDetails", {})
            return {
                "videoId": details.get("videoId"), "title": details.get("title"),
                "artists": [{"name": details.get("author"), "id": details.get("channelId")}],
                "duration_seconds": int(details.get("lengthSeconds", 0)),
                "thumbnails": details.get("thumbnail", {}).get("thumbnails", []),
                "is_live": details.get("isLiveContent", False),
            }
        raise ValueError("Unknown catalogue operation")


try:
    print(json.dumps(main(), ensure_ascii=False))
except Exception:
    # Do not send upstream response bodies or authentication data to the client.
    print(json.dumps({"error": "catalogue"}), file=sys.stderr)
    sys.exit(1)
