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
- Newly configured, created and reset passwords require at least 15 characters and must differ from the profile
  name. Existing passwords remain usable until changed. This follows the length guidance for authentication
  without MFA in the [OWASP authentication guide](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#implement-proper-password-strength-controls).
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

## Publication checks

Run `npm run check:public` after staging changes. It rejects unrelated history, non-noreply Git identities,
private/generated files, unresolved conflicts, common credential formats and personal machine paths, including
new historical blobs that no longer appear in the latest tree. To check
additional private identifiers, set `DECIBEL_PRIVACY_PATTERNS_FILE` to a local file **outside this repository**
containing one exact string per line. The check reports file names, never matched values. Also run a full
secret scanner over the final history; the built-in patterns are a supplementary check.

CI uses read-only repository permissions, does not persist checkout credentials, runs the normal tests with
real extraction disabled and audits production JavaScript dependencies.

## Known dependency limitations

- Production JavaScript dependencies are audited separately from development tools. The Next.js ESLint
  plugin still uses `braces` through `fast-glob`; its nested-pattern denial-of-service advisory has no patched
  release in the compatible dependency line. It is used by local linting on repository-controlled patterns,
  not by the HTTP server. Track [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
- Tauri's Linux GTK stack still resolves `glib 0.18`, with an informational unsound-iterator advisory, and the
  unmaintained `proc-macro-error` build tool. They need upstream-compatible fixes; no exploitable use in Decibel
  was established. See [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) and
  [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html).
- Native clients currently keep long-lived Bearer tokens in JavaScript-accessible local storage and do not
  enforce a CSP. Same-origin web sessions use HttpOnly cookies. No XSS has been demonstrated; use trusted
  devices, sign out on shared devices and keep the app and WebView updated.

The committed Cargo lockfile pins patched TLS libraries. Legacy compressed updater bundles are disabled;
current raw NSIS and .deb updates retain signature verification.
