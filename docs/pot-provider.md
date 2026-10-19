# YouTube PO token provider (optional)

YouTube sometimes answers a song with "Sign in to confirm you're not a bot". yt-dlp can then present
Proof-of-Origin (PO) tokens from [bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider),
the provider recommended by the yt-dlp [PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide).
No Google account or cookies are used. A PO token does not lift IP-level blocks: it makes bot checks rarer, it does
not rule them out.

The provider is off by default. Decibel works without it.

## Pieces

- **Provider:** the bgutil HTTP server, run as its own service and listening on localhost only (its default port
  is `4416`). Follow the upstream README to build and run it, and run it as an unprivileged user with a read-only
  filesystem if you use systemd.
- **Plugin:** the `bgutil-ytdlp-pot-provider` wheel is pinned in `server/requirements.txt`, so
  `npm run music:setup` (or `deploy/systemd/install.sh`) installs it in the same Python environment as yt-dlp.
  Keep the provider and the plugin on the same version.
- **Wiring:** two environment variables on the Decibel service:
  - `YTDLP_POT_URL`: the provider's base URL, e.g. `http://127.0.0.1:4416`. This switches the feature on.
  - `YTDLP_PLUGIN_DIRS`: the `site-packages` parent of that Python environment, e.g.
    `/opt/decibel-runtime/ytmusic/lib/python3.13`. Use a folder the service user cannot write to.

  With them, `server/ytdlp.mjs` (CLI fallback) and `server/ytdlp-worker.py` (resident worker) load yt-dlp plugins
  only from that folder, pass `youtubepot-bgutilhttp:base_url=…` and add `mweb` after yt-dlp's default clients
  (`youtube:player_client=default,mweb`). Without `YTDLP_POT_URL`, plugins stay disabled. If the provider is down,
  yt-dlp only warns and keeps using the default clients.

  The systemd unit in `deploy/systemd/decibel.service` has both lines commented out.
- **Health:** `/api/music/health` includes `pot: { enabled, ok, version | error }`. It never fails the health
  check.

## Check

```sh
curl -s http://127.0.0.1:4416/ping                 # on the server: {"server_uptime":…,"version":"…"}
curl -s https://your-server/api/music/health        # "pot":{"enabled":true,"ok":true,…}
journalctl -u decibel -g '\[stream\]' -n 50 --no-pager
```

`[stream]` log lines record failed audio resolutions and the replacement uploads used.
