# Contributing to Decibel

Thanks for your interest in improving Decibel! This document explains how to propose changes.
By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Workflow

1. **Fork** the repository and create a branch from `main` with a descriptive name
   (`fix/queue-reorder`, `feat/lyrics-offset`…).
2. Make your change. Keep **one change per pull request**: a bug fix, a feature or a refactor, not several at once.
3. Run all the checks locally (see below).
4. Open a **pull request against `main`** using the template. Explain **what** changes and **why**, and link the
   related issue if there is one.

## Commit messages

Write clear commit messages: a short summary line in the imperative mood (≈ 72 characters max), then a blank
line and, if useful, a body explaining the motivation and any trade-offs. Example:

```
Keep the queue position when removing the current track

Removing the playing track jumped back to the first item. Use the next
index instead and add a test for the edge case of the last track.
```

## Checks before opening a PR

All of these must pass:

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # server and client tests (Node 22.9+)
npm run build       # next build
```

Add or update tests when you change behaviour (`server/*.test.mjs`, `tests/*.test.mjs`).

## Visual changes: before/after screenshots are mandatory

**Every visual or aesthetic change** (layout, spacing, colours, typography, icons, animations, new screens) must
include **BEFORE and AFTER screenshots** in the pull request:

- Same screen, same state and **same viewport** for both: **mobile 412×915** and, if the change affects it,
  **desktop** (e.g. 1440×900).
- **No personal data**: use demo data (`NEXT_PUBLIC_DATA_SOURCE=mock`) or generic profile names; no real e-mail
  addresses, server URLs, IPs or listening history.
- For animations or interactions, a short video or GIF is welcome in addition to the screenshots.

Pull requests with visual changes and no before/after screenshots will not be reviewed until they are added.

## Things you must never commit

- Secrets of any kind: tokens, passwords, cookies (including YouTube cookies).
- `.env`, `.env.local` or any other env file (only `.env.example` is versioned).
- Android keystores (`*.jks`, `*.keystore`), `keystore.properties`, signed APKs/AABs.
- Databases and backups (`*.db`, `*.sqlite`, `data/`, `backups/`), logs and tunnel credentials.

`.gitignore` covers these, but please double-check `git status` before committing.

## Language

The app's user interface is currently in Spanish. Code, identifiers and documentation are in English; new UI
strings may be in Spanish to stay consistent. Proposals to add proper internationalisation are welcome — open an
issue first to discuss the approach.

## Reporting bugs and requesting features

- **Bugs**: open an issue with the **Bug report** template. Include the version (Profile panel or
  `src/lib/version.ts`), platform (web/PWA/Android, browser), music source, steps to reproduce, expected vs. actual
  behaviour and, if possible, screenshots or logs without personal data.
- **Feature requests**: open an issue with the **Feature request** template describing the problem first, then
  your proposed solution and the alternatives you considered.
- **Security issues**: do not open a public issue; follow [SECURITY.md](SECURITY.md).

## Licence

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
