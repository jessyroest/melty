# Contributing to melty

Welcome. This guide gets you from a fresh clone to a green pull request. Read the **hard rules** section before you write any code: they are not style preferences, and a PR that breaks one will not be merged.

The [README](README.md) explains what melty does, how it is deployed and what the threat model is. [ASSUMPTIONS.md](ASSUMPTIONS.md) records every choice made where the spec left room. Both are worth ten minutes before you start.

## Prerequisites

- **Node.js 22 or newer.** The relay's `wrangler` requires Node 22+ (Vite would accept 20.19+, but the relay won't start on it). The repo has an `.nvmrc`, so `nvm use` or `fnm use` picks the right version. CI runs Node 22; development has also been done on Node 24.
- **pnpm 10.** The exact version is pinned in the `packageManager` field of the root `package.json`.
- **git.**
- **Microsoft Edge or Google Chrome**, only if you want to run the browser e2e tests. Nothing is downloaded for them.

### Installing pnpm

Either of these works:

```sh
# option 1: plain npm, works everywhere
npm i -g pnpm@10

# option 2: corepack, which uses the exact version from package.json
corepack enable
```

On Windows, `corepack enable` writes into `C:\Program Files\nodejs` and usually needs an **administrator** terminal. If it fails with a permission error, use option 1 instead (that is what the owner did, see ASSUMPTIONS.md). Corepack is no longer bundled with Node 25 and later; use option 1 there too.

Check with `pnpm --version`; it should print `10.x`.

## Setup

```sh
git clone https://github.com/jessyroest/melty.git
cd melty
pnpm install
pnpm dev
```

`pnpm dev` starts both packages in parallel:

| what | where | notes |
|---|---|---|
| web (Vite dev server) | http://localhost:5173 | hot reload; runs **without** the strict CSP, because hot reload injects inline scripts |
| relay (`wrangler dev`) | ws://localhost:8787 | local Durable Objects in workerd; nothing to log in to |

Both use `--strictPort` / a fixed port, so they fail instead of picking another port if one is taken (see [gotchas](#known-gotchas)).

To try a room with two people, open the room link in a second browser or a private window.

### Production-like setup (strict CSP)

The dev server can hide CSP problems. Before you open a PR that touches the UI, run the built app with the real production headers:

```sh
pnpm build                          # type-checks and builds web/dist
pnpm --filter @melty/relay dev      # terminal 1, relay on :8787
pnpm --filter @melty/web preview    # terminal 2, http://localhost:4173
```

`vite preview` serves `web/dist` with the same security headers as production. No `.env` file is needed locally: the web app defaults to `ws://localhost:8787` and the relay already allows `http://localhost:5173` and `http://localhost:4173`.

## Tests and checks

| command | needs running servers? | what it does |
|---|---|---|
| `pnpm lint` | no | ESLint over web, relay and scripts (config: `eslint.config.mjs`). Must exit with **0 errors**. Warnings are known findings from when ESLint was introduced (listed as `TODO(lint)` in the config); don't add new ones. `console.*` in `relay/src` is an error |
| `pnpm typecheck` | no | `tsc --noEmit` for web and relay |
| `pnpm test` | no | web unit tests (crypto) and relay tests in workerd via `@cloudflare/vitest-plugin`, including a test that the relay produces no console output |
| `pnpm check:logs` | no | static check: no `console.*` / logging calls in `relay/src`, Workers observability off, no logpush or tail consumers |
| `pnpm check:bundle` | no, but run `pnpm build` first | the built bundle references only our own origin and the relay: no external URLs, no inline scripts or styles, no `data:` URIs |
| `pnpm check` | no | `lint` + `typecheck` + `test` + `build` + `check:bundle` + `check:logs` in one go. Run this before every PR. |
| `pnpm e2e` | **yes**: relay on :8787 and `web preview` on :4173 | two real browser sessions chat through the relay; also checks the fragment leaves the address bar, no storage or cookies are used, no request leaves our origin + relay, no CSP violations |
| `pnpm e2e:features` | **yes**: same as `pnpm e2e` | three browsers check typing, reactions, burn after reading, lock / unlock and melt now, plus no CSP violations |
| `pnpm e2e:xss` | **yes**: same as `pnpm e2e` | hostile messages and nicknames stay text; bidi isolation |
| `pnpm e2e:resilience` | **yes**: same as `pnpm e2e` | offline and back, error screens, unreachable relay |
| `pnpm e2e:phase2` | **yes**: same as `pnpm e2e` | 4 words and a knock, matching safety words, link joins answered by any member, only padded sizes and no plaintext on the wire |

For the e2e tests, start the production-like setup above first (build, relay, preview), then run them from a third terminal.

The e2e tests drive your locally installed **Edge** by default (through `playwright-core`). To use Chrome instead:

```sh
# macOS / Linux / Git Bash
BROWSER_CHANNEL=chrome pnpm e2e
BROWSER_CHANNEL=chrome pnpm e2e:features
```

```powershell
# Windows PowerShell
$env:BROWSER_CHANNEL = "chrome"; pnpm e2e
```

On macOS you most likely need `BROWSER_CHANNEL=chrome` unless you have Edge installed. Without an installed browser (a container, CI image), point `BROWSER_PATH` at any Chromium binary. Set `SHOTS_DIR=<folder>` to have the tests save screenshots there.

CI runs `pnpm lint`, the web and relay typechecks, `pnpm test`, `pnpm build`, `pnpm check:bundle`, `pnpm check:logs` and the e2e tests (with Chrome) on every push and pull request to `main`. See [.github/workflows/ci.yml](.github/workflows/ci.yml).

CI also runs a **secrets scan** with [gitleaks](https://github.com/gitleaks/gitleaks-action) over the full git history. If it flags something, don't just delete the line in a new commit: the value is still in history. Treat it as leaked, revoke or rotate it first, then ask the owner how to clean up the history. A false positive can be allowlisted in a `.gitleaksignore` file, with the reason in the PR.

### Dependencies

All versions in the three `package.json` files are pinned exactly (no `^` or `~`), and `pnpm-lock.yaml` is committed. CI installs with `--frozen-lockfile`, so a `package.json` change without the matching lockfile change fails.

- Add a dependency with `pnpm add -E <pkg>` (in the right package, or `-w` for the root) so it is pinned too. Every new runtime dependency in `web/` ends up in the shipped bundle: keep them rare and self-hostable.
- **Dependabot** opens update PRs every Monday ([.github/dependabot.yml](.github/dependabot.yml)): one grouped PR for all minor and patch bumps, a separate PR per major bump, and one for GitHub Actions. Treat them like any other PR: CI must be green, and read the changelog for anything that touches crypto, the relay, the build or the CSP. Major bumps need the owner's review.

## Project structure

```
melty/
├─ package.json              root scripts (dev, build, lint, typecheck, test, check, e2e)
├─ eslint.config.mjs         ESLint flat config for the whole repo
├─ pnpm-workspace.yaml       workspace: web + relay
├─ web/                      @melty/web: Vite + React 19 + TypeScript, hand-written CSS
│  ├─ index.html
│  ├─ vite.config.ts         build settings (no inlining, no modulepreload polyfill), preview headers
│  ├─ headers.mjs            the CSP and other security headers, used by preview and production
│  ├─ public/                static files served as-is (favicon, brand images, icons, manifest, robots.txt)
│  ├─ sw.template.js         the service worker; the build fills in the list of files it may cache
│  ├─ design-src/            reference images only; not shipped
│  ├─ scripts/gen-vercel.mjs writes web/vercel.json for a Vercel deploy
│  └─ src/
│     ├─ main.tsx            entry point; imports every stylesheet
│     ├─ App.tsx             top-level routing between home, room and how-it-works
│     ├─ state/session.ts    the room session: keys, connection, messages, wipe. Everything is kept in memory here.
│     ├─ crypto/
│     │  ├─ derive.ts        link secret → roomId + psk (HKDF-SHA256); room key import (non-extractable)
│     │  ├─ frame.ts         room messages: padding, sender id + counter in the AAD, replay guard
│     │  ├─ kx.ts            the hybrid X25519 + ML-KEM-768 key exchange, safety words, bundle sealing
│     │  ├─ words.ts         4-word door codes and safety words (wordlist.ts: the EFF short list)
│     │  ├─ aead.ts          seal / open with AES-GCM, fresh random IV
│     │  ├─ message.ts       the inner (encrypted) message format and size limit
│     │  └─ *.test.ts        unit tests for all of the above
│     ├─ net/relay.ts        WebSocket client for the relay
│     ├─ lib/                small helpers: base64url, nicknames, router
│     ├─ ui/                 React components
│     │  ├─ Home.tsx, Chat.tsx (the room), HowItWorks.tsx   pages
│     │  ├─ Room*.tsx        the room UI (bar, bubbles, composer, messages, sheet, cube)
│     │  ├─ Mascot.tsx, LiveMascot.tsx, Logo.tsx      the mascot and wordmark (hand-drawn SVG)
│     │  └─ landing/         one component per landing-page section
│     └─ styles/             one CSS file per section
│        ├─ tokens.css       design tokens; dark is the default, light follows prefers-color-scheme
│        ├─ app.css          base styles and shared components
│        ├─ landing.css      shared landing-page type and layout
│        ├─ hero.css, never.css, melt.css, works.css, uses.css, honest.css, final.css
│        │                   one per landing section (matching the components in ui/landing/)
│        ├─ mascot.css, logo.css
│        ├─ room.css         the room UI
│        └─ how.css          the how-it-works page
├─ relay/                    @melty/relay: Cloudflare Worker
│  ├─ wrangler.jsonc         worker config: observability off, ALLOWED_ORIGINS
│  ├─ src/
│  │  ├─ index.ts            the Worker: routing, origin check, creation limit, hands sockets to a Room
│  │  ├─ room.ts             the Room Durable Object (one per room): forwarding, key-exchange routing, lobby, limits, expiry, lock / melt
│  │  ├─ door.ts             the Door Durable Object (one per set of 4 words): which room they point to, until expiry
│  │  ├─ offer.ts            strict parsing of the Sec-WebSocket-Protocol offer
│  │  ├─ protocol.ts         the wire protocol and limits, shared with web via the @relay/protocol alias
│  │  ├─ limiter.ts          in-memory per-IP limits: connections, knocks, room creations
│  │  └─ ws.ts               small WebSocket helpers
│  └─ test/                  relay tests (run in workerd)
└─ scripts/                  check-bundle, check-relay-logs, e2e-*, history-check, brand-images
```

A new landing section usually means a new component in `web/src/ui/landing/` plus its own CSS file in `web/src/styles/`, imported in `main.tsx`. Use the tokens in `tokens.css` instead of hard-coded colours, so dark and light both work.

If you change the wire protocol, change `relay/src/protocol.ts` once; the web app imports the same file.

## Hard rules

These come from the owner's spec. Every PR is checked against them.

**Honest claims**

- [ ] No claim in the UI, README or metadata that isn't demonstrably in the code.
- [ ] "post-quantum" only for the key exchange (X25519 + ML-KEM-768), which is built and tested; never for the app as a whole.
- [ ] Never use "zk", "military grade", "100% anonymous", "unhackable" or "anonymous".

**No storage, no logs**

- [ ] The server never stores message content. The relay stores only what is documented in the README (the expiry time, and a tombstone afterwards).
- [ ] Nothing logs messages, IPs, roomIds or secrets.
- [ ] No `console.log` (or any `console.*`) in the relay at all. `pnpm check:logs` and the relay tests enforce this.
- [ ] No `console.*` with plaintext, keys or link fragments anywhere in the web app either.

**Keys live only in memory**

- [ ] Never put keys, secrets or messages in `localStorage`, `sessionStorage`, IndexedDB, cookies or the URL query. (The secret travels only in the URL fragment, which is removed from the address bar right after opening.)

**Self-hosted only**

- [ ] No analytics, no tracking, no third-party scripts.
- [ ] No fonts or images from CDNs. Fonts come from npm (`@fontsource-variable/*`) and are bundled; images go in `web/public/`.

**Strict CSP**

- [ ] No inline scripts or `<style>` blocks, no `dangerouslySetInnerHTML`, no `innerHTML`.
- [ ] No `data:` URIs (watch out for inlined SVGs or images in CSS).
- [ ] Check in the production-like setup (`web preview`), not only in `pnpm dev`. `pnpm check:bundle` and the e2e tests catch most problems.

**Scope**

- [ ] No file uploads.
- [ ] No wallet or token functionality in the app.
- [ ] Don't copy names, mascots, slogans or text from existing products.

**Design and accessibility**

- [ ] Respect `prefers-reduced-motion`: every animation and transition must switch off under it.
- [ ] Mobile-first and usable from 390px to 1440px wide.
- [ ] Works in both dark and light themes.
- [ ] Accessible: real buttons and labels, keyboard reachable, visible focus, sufficient contrast.

**Process**

- [ ] Work phase by phase: plan first, then build.
- [ ] Record every choice you make yourself (anything the spec or an issue didn't pin down) in [ASSUMPTIONS.md](ASSUMPTIONS.md).
- [ ] If a change affects what the relay can see or what the app protects against, update the threat model in the README.

## Git workflow

1. Start from an up-to-date `main`:
   ```sh
   git switch main
   git pull
   git switch -c feature/<short-name>     # e.g. feature/qr-download
   ```
2. Make small, focused commits with clear messages (what and why).
3. Run `pnpm check` locally. If you touched the UI or the relay, also run the e2e tests against the production-like setup.
4. Push your branch and open a pull request against `main`. Fill in the PR template, including the hard-rules checklist.
5. CI must be green. The owner reviews and merges.

Never:

- push directly to, or force-push, `main`;
- commit `.env.local`, `web/.env.local` or `relay/.dev.vars` (they are in `.gitignore`; keep it that way);
- commit `node_modules`, `dist` or `.wrangler`.

Line endings are normalised to LF by `.gitattributes`, and `.editorconfig` sets 2-space indentation, UTF-8 and a final newline. Most editors pick this up automatically.

## Known gotchas

- **Python on Windows uses cp1252 by default.** Several files contain non-ASCII characters (emoji, arrows, `≥`). If you use a Python script to read or rewrite files, run it as `python -X utf8 script.py` (or open files with `encoding="utf-8"`), or it will crash or corrupt them.
- **`wrangler dev` prints request paths, and those contain room ids.** The relay's `dev` script therefore runs `wrangler dev --port 8787 --log-level warn`. Always start the relay through `pnpm dev` or `pnpm --filter @melty/relay dev`, not with a bare `wrangler dev`, and don't paste relay output into issues without checking it.
- **Ports can be held by leftover `workerd` processes.** If the relay or a test exits uncleanly, `workerd` may keep port 8787 (or Vite keeps 5173 / 4173), and the next start fails because the ports are strict. Find and stop the process:
  ```sh
  # macOS / Linux
  lsof -i :8787
  pkill workerd
  ```
  ```powershell
  # Windows
  netstat -ano | findstr :8787
  taskkill /F /IM workerd.exe
  ```
- **`pnpm check` and `pnpm build` overwrite `web/dist`.** Stop `web preview` first if it is serving that folder, or restart it afterwards.
- **The dev server has no CSP.** Something that works in `pnpm dev` can still be blocked in production. Test UI changes with `web preview`.
- **Refreshing a room loses it.** That is by design: the secret is removed from the address bar and only kept in memory.
