# Security Policy

## Supported versions

Only the latest version of the `main` branch receives fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Use **GitHub → Security → Report a vulnerability** (private advisory) in
this repository and include:

- the affected version or commit;
- steps to reproduce;
- the impact you observed.

We will answer as soon as possible. This is a personal project maintained in spare time, so there are no
guaranteed response times.

## Security model in brief

- Every `/api/*` endpoint requires a session except `GET /api/health`, `GET /api/music/health` and
  `POST /api/auth/login`.
- Passwords are hashed with scrypt. Sessions are random 256-bit tokens and only their SHA-256 is stored. The
  cookie is HttpOnly and SameSite=Lax, and `Secure` behind HTTPS.
- Login limits failed attempts per IP and per user name.
- Outgoing requests for podcast feeds, artwork and audio only go to public addresses: DNS is resolved and
  pinned, and redirects are validated. YouTube artwork is only fetched from its CDNs, without redirects.
- CORS: exact same origin or the origins listed in `YTDLP_ALLOWED_ORIGINS`.
- Proxy headers (`X-Forwarded-Proto`, `CF-Connecting-IP`) are only accepted from the proxies in
  `DECIBEL_TRUST_PROXY`.

## Recommendations for self-hosters

- Listen on `127.0.0.1` and publish only behind HTTPS (tunnel or reverse proxy).
- Use long passwords for every profile: the login page is public on your domain.
- Never commit `.env.local`, the database, tunnel credentials, the Android keystore or YouTube cookies.
