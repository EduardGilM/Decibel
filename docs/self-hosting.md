# Self-hosting Decibel

This guide installs Decibel on your own Linux server and publishes it with **Cloudflare Tunnel** as an example.
`decibel.example.com` is used as the example domain; replace it with yours. Any HTTPS reverse proxy works the same
way (Caddy, nginx, Traefik…).

## Requirements

- Linux x86_64 or ARM64 with systemd.
- Node.js 22.9 or later.
- Python 3.10 or later with `venv`.
- No ffmpeg and no external database needed: profiles are stored in SQLite (`node:sqlite`).

## 1. Build and run on the same machine

```sh
git clone https://github.com/<you>/Decibel.git decibel && cd decibel
npm ci
npm run music:setup        # verified yt-dlp and ytmusicapi in .tools/
cp .env.example .env.local # adjust the values
npm run build              # generates out/
npm run serve              # web app + API on MUSIC_HOST:MUSIC_PORT (3000)
```

On the **first start**, with an empty database, a single administrator is created:

- user name `DECIBEL_ADMIN_USER` (default `admin`);
- password `DECIBEL_ADMIN_PASSWORD`, or a random one printed **only once** in the log.

Open `/admin` and create the other profiles. See [profiles.md](profiles.md).

## 2. systemd service with an unprivileged user

[`deploy/systemd/`](../deploy/systemd/) contains a hardened example:

- `decibel.service`: user `decibel`, `ProtectSystem=strict`, data in `/var/lib/decibel`, listens on `127.0.0.1` only.
- `install.sh`: installs a package built with `npm run package:server`. It backs up the database and the library
  before replacing the application, and rolls back if the health check fails.
- `check-health.mjs`: availability check (health endpoints, authentication required, CORS, download blocking).

Review the paths before using it. The packager accepts `--output`, `--node-archive` (official
`node-v22.23.3-linux-x64.tar.xz`, verified by SHA-256), `--python` and `--skip-build`. The bundled Python wheels
target Python 3.13 (Debian 13); with a different Python, install directly as in step 1.

Important variables in the unit:

| Variable | Example | Notes |
| --- | --- | --- |
| `MUSIC_HOST` | `127.0.0.1` | Do not expose the port directly to the Internet; publish it through the tunnel or proxy. |
| `MUSIC_PORT` | `3000` | |
| `DECIBEL_DB` | `/var/lib/decibel/decibel.db` | Back up this file. |
| `MUSIC_DATA_DIR` | `/var/lib/decibel/music` | |
| `DECIBEL_TRUST_PROXY` | `loopback` | Required behind a tunnel or HTTPS proxy on the same machine. Without it, web logins over `https://` are rejected by the origin check, the cookie is not `Secure` and login rate limiting sees a single IP. If the proxy runs on another machine, set its IP. |
| `YTDLP_ALLOWED_ORIGINS` | `tauri://localhost,http://tauri.localhost,https://tauri.localhost` | Extra origins (native app, web app on another domain), with exact scheme and port. |

Create the first admin with a known password by adding, for the first start only:

```ini
Environment=DECIBEL_ADMIN_USER=admin
Environment=DECIBEL_ADMIN_PASSWORD=<a long password>
```

or leave them out and read the generated password with `journalctl -u decibel`. Remove the password from the unit
afterwards: it is ignored once profiles exist.

## 3. Publish with Cloudflare Tunnel (example)

```sh
cloudflared tunnel login
cloudflared tunnel create decibel
cloudflared tunnel route dns decibel decibel.example.com
```

`/etc/cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL-ID>
credentials-file: /etc/cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: decibel.example.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

```sh
sudo cloudflared service install
```

- `<TUNNEL-ID>.json` and `cert.pem` are **credentials**: never copy them into the repository or share them.
- Optional: put Cloudflare Access in front if only you or your family will use it.
- Remember that Decibel's login page is public on that domain: use long passwords for every profile.

With a reverse proxy instead (Caddy example):

```
decibel.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

## 4. Updating

Build a new package, or in a direct install run `git pull && npm ci && npm run build` and restart the service.
Profiles, library and sessions are kept in `DECIBEL_DB` and `MUSIC_DATA_DIR`. To update only yt-dlp, run
`npm run music:setup` again.

## 5. Android app (APK) with your own server and signing key

The APK is the same web build packaged with Tauri v2 plus some native code (`src-tauri/android-overlay/`).
Step-by-step instructions (SDK/NDK, build, `keytool`, `zipalign`, `apksigner` and `keystore.properties`) are in the
README: [Building the Android APK](../README.md#building-the-android-apk).

- Choose your own application id in `src-tauri/tauri.conf.json` (`identifier`) if you distribute your build.
- Keep the keystore and `keystore.properties` outside git (both are in `.gitignore`).
- On the server, keep the Tauri origins in `YTDLP_ALLOWED_ORIGINS`.

## Backups

Only `DECIBEL_DB` and `MUSIC_DATA_DIR` are needed. Back up the database while running with SQLite's online
backup API (as `install.sh` does) or with the service stopped, for example:

```sh
sqlite3 /var/lib/decibel/decibel.db ".backup '/var/backups/decibel-$(date +%F).db'"
```
