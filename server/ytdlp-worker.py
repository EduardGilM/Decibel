"""Trabajador residente de yt-dlp: una sola importación atiende todas las canciones por stdin.

Protocolo JSONL — petición: {"id": N, "op": "extract"|"version", "url": "...", "direct": bool};
respuesta: {"id": N, "ok": true, "info": {...} | "version": "..."} o {"id": N, "ok": false, "error": "..."}.
El proceso termina solo cuando el servidor cierra stdin.
"""
import json
import sys


def main() -> None:
    cache_dir = sys.argv[1] if len(sys.argv) > 1 else None
    node = sys.argv[2] if len(sys.argv) > 2 else None
    import yt_dlp

    formats = "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio[ext=mp3]/bestaudio[ext=ogg]/bestaudio[ext=opus]"
    fields = ("id", "is_live", "url", "title", "track", "artist", "album", "uploader", "channel", "duration", "release_year", "upload_date")
    sessions: dict[bool, yt_dlp.YoutubeDL] = {}

    def session(direct: bool) -> yt_dlp.YoutubeDL:
        # La instancia reutiliza la agrupación de conexiones y los retos JS entre canciones.
        if direct not in sessions:
            options: dict = {
                "quiet": True, "no_warnings": True, "noplaylist": True, "skip_download": True,
                "format": formats, "socket_timeout": 15, "retries": 1, "extractor_retries": 1,
            }
            if cache_dir:
                options["cachedir"] = cache_dir
            if direct:
                options["extractor_args"] = {"youtube": {"skip": ["hls"]}}
            # Sin un runtime JS explícito YouTube no resuelve el reto n y acapara las URLs.
            options["js_runtimes"] = {"node": {"path": node}} if node else {}
            sessions[direct] = yt_dlp.YoutubeDL(options)
        return sessions[direct]

    def send(payload: dict) -> None:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    send({"event": "ready", "version": yt_dlp.version.__version__})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except ValueError:
            continue
        ident = request.get("id")
        try:
            if request["op"] == "version":
                send({"id": ident, "ok": True, "version": yt_dlp.version.__version__})
            elif request["op"] == "extract":
                info = session(bool(request.get("direct"))).extract_info(request["url"], download=False)
                send({"id": ident, "ok": True, "info": {key: info.get(key) for key in fields}})
            else:
                send({"id": ident, "ok": False, "error": f"Operación desconocida: {request['op']!r}"})
        except Exception as error:  # yt-dlp lanza DownloadError con el detalle de YouTube
            send({"id": ident, "ok": False, "error": str(error) or error.__class__.__name__})


if __name__ == "__main__":
    main()
