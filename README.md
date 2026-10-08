# melty

Temporary chat rooms, no account needed. You open a room, share the link (or QR code), and talk. When the timer runs out, the room melts: the relay closes every connection and deletes the room, and every browser wipes its messages and keys.

Messages are **end-to-end encrypted** (AES-256-GCM). The relay only ever sees a room id and ciphertext, and it stores nothing except when the room expires.

> Status: phases 1 and 3 are done. The 4-word codes and the hybrid key exchange (phase 2) are not built yet.
> melty has **not been independently audited**. The security properties below are what the code is designed and tested to do, not the result of an outside review.

## Features

- Rooms that melt after 10 minutes, 1 hour or 24 hours. Share them by link or QR code.
- **Burn after reading.** A message arrives frozen; once someone opens it, it melts away 10 seconds later. The sender's own copy goes 10 seconds after sending.
- **Typing indicator**, sent encrypted, at most once every 3 seconds.
- **Reactions** 🧊 💧 🔥 👍, sent encrypted.
- **Creator controls:**
  - **lock the room**, so nobody new can join, not even with the link
  - **melt it now** (press and hold), which wipes the room for everyone immediately

```
web/     Vite + React + TypeScript client (UI in English)
relay/   Cloudflare Worker + Durable Objects (one per room, WebSocket Hibernation API)
scripts/ bundle / log checks and a browser end-to-end smoke test
```

## Run locally

Requirements: Node 22+ (wrangler needs it; tested on 24) and pnpm 10.

```sh
pnpm install
pnpm dev
```

- web: http://localhost:5173
- relay: ws://localhost:8787

`pnpm dev` starts both. The Vite dev server runs **without** the strict CSP, because hot reload needs inline scripts. To try the app with the real production headers:

```sh
pnpm build
pnpm --filter @melty/relay dev      # terminal 1
pnpm --filter @melty/web preview    # terminal 2 → http://localhost:4173
```

To test with two people, open the room link in a second browser or a private window. A second tab in the same window also works, because nothing is shared between tabs.

### Tests and checks

| command | what it checks |
|---|---|
| `pnpm lint` | ESLint over web, relay and scripts (`eslint.config.mjs`). Errors fail CI; `console.*` in `relay/src` is an error |
| `pnpm test` | web: crypto (AES-GCM roundtrip; wrong key / tampered ciphertext / IV / AAD fail; HKDF determinism; roomId doesn't leak the secret). relay (in workerd via `@cloudflare/vitest-plugin`): forwarding, nothing stored, expiry + refusal afterwards, every limit, origin check, and **no console output during a full room lifecycle** |
| `pnpm check:logs` | no logging calls in `relay/src`, Workers observability off, no logpush / tail consumers |
| `pnpm build && pnpm check:bundle` | the built bundle references only our own origin and the relay: no external URLs, no inline scripts/styles, no `data:` URIs |
| `pnpm e2e:features` | needs the same setup. Three browsers check typing, reactions, burn-after-read, lock / unlock, and melt-now, plus no CSP violations |
| `pnpm e2e` | needs the relay and `preview` running. Two real browser sessions chat through the relay. Also checks: the fragment leaves the address bar; no web storage, cookies or IndexedDB are used; no request leaves our origin + relay; no CSP violations |
| `pnpm typecheck` | `tsc --noEmit` for web and relay |
| `pnpm check` | lint + typecheck + test + build + check:bundle + check:logs |

The e2e test uses your locally installed Edge (`BROWSER_CHANNEL=chrome` for Chrome) through `playwright-core`. Nothing is downloaded.

## Deploy

### Relay → Cloudflare Workers

1. In `relay/wrangler.jsonc`, set `ALLOWED_ORIGINS` to your web origin(s), for example `https://melty.pages.dev`.
2. Deploy:
   ```sh
   cd relay
   npx wrangler login
   pnpm deploy
   ```
   Note the URL, e.g. `https://melty-relay.<account>.workers.dev`. The app connects to it as `wss://…`.
3. Leave observability **off**; `pnpm check:logs` fails if it's on. Don't add Logpush or tail workers.

### Web → Cloudflare Pages

Build settings:

- root directory: `web`
- build command: `pnpm build`
- output directory: `dist`
- environment variables:
  - `VITE_RELAY_URL=wss://melty-relay.<account>.workers.dev`
  - `VITE_PUBLIC_ORIGIN=https://<your pages domain>`

The build writes `dist/_headers` with the CSP (`connect-src` set to your relay), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and a `Permissions-Policy` that turns off camera, microphone and geolocation. Pages serves `index.html` for `/r` and `/how` by itself.

### Web → Vercel (alternative)

```sh
VITE_RELAY_URL=wss://melty-relay.<account>.workers.dev pnpm --filter @melty/web gen:vercel
```

This writes `web/vercel.json` with the same headers plus SPA rewrites. Then:

- set the project root to `web`
- set `VITE_RELAY_URL` and `VITE_PUBLIC_ORIGIN` in the Vercel environment
- deploy

After deploying either way, open the site and check the response headers in devtools.

## How it works

1. **Opening a room.** The browser generates a 32-byte random secret (`crypto.getRandomValues`). It goes into the link after the `#`, like `/r#<secret>`. Browsers don't send the fragment to servers. The creator's own address bar never shows it.
2. **Deriving.** HKDF-SHA256 over the secret derives two values:
   - `roomId` (`info="room-id-v1"`): sent to the relay.
   - an AES-256-GCM key (`info="room-key-v1"`): non-extractable, never leaves the browser.
3. **Messages.** Chat messages and join / leave / nickname notices are JSON. Each one is encrypted with a fresh random 12-byte IV, with the roomId as additional data. The relay receives `{iv, ct}` and nothing else.
4. **Transport.** The browser connects to the fixed path `wss://<relay>/ws`. The room id travels in the `Sec-WebSocket-Protocol` header, never in the URL path or query. So do the ttl and the SHA-256 of the creator secret when creating a room: `melty.v1, r.<roomId>, c.<ttl>, o.<hash>`. The relay answers with `Sec-WebSocket-Protocol: melty.v1`.
5. **Relay.** One Durable Object per room. It forwards ciphertext to the other sockets and stores only `expiresAt`. It also enforces these limits:

   | limit | value |
   |---|---|
   | people per room | 8 |
   | plaintext per message | 4 KB |
   | messages per connection | 5 per second |
   | messages per room, all connections together | 20 per second (burst 20; in the room object's memory, never stored) |
   | connection attempts per IP (joins, creates, reconnects) | 60 per minute |
   | new rooms per IP | 20 per hour |

   Per-IP counts are kept in memory under an HMAC of the address with a random per-instance key, and never stored. Over the connection limit a socket is refused with `slow` (close code 4031).

6. **Expiry.** At `expiresAt` an alarm fires. It sends `expired` and closes every socket, then deletes all state. For 24 hours afterwards a tombstone refuses the room id, and then the tombstone is deleted too.
7. **Creator controls.**
   - The creator's browser makes a second random 32-byte secret and gives the relay only its SHA-256.
   - The relay keeps that hash, and the room's locked flag, on the open sockets in memory, never in storage.
   - To lock or melt, the creator sends the secret itself; the relay checks it against the hash.
   - When the room has nobody in it, the creator rights are gone, and a later joiner can't claim them.
8. **Client.** The client keeps everything in memory only. Expiry, leaving or closing the tab wipes the secret (zeroed), the key and the messages, and returns to the start screen. The countdown uses the relay's clock.

## Threat model

This threat model has **not been independently audited**. It describes what the code is built to do; no outside party has reviewed or tested it.

**Protects against**

- **The server reading messages.** The relay never has the key, only `roomId` + ciphertext.
- **Stored chat history.** Nothing is stored on the server. Clients keep messages in memory only and drop them when the room ends.
- **Later decryption of recorded traffic, as long as the link stays secret.** Phase 1 has no key exchange: *the link is the key*. Anyone who later obtains the link and also has recorded traffic can decrypt it. Phase 2 adds a key exchange so links don't have to carry the key.

**Does not protect against**

- Screenshots, or photos of the screen.
- Compromised devices, or malicious browser extensions.
- Someone forwarding the link. Whoever has it can read along and post under any nickname. Nicknames are not verified.
- Where the link travels: the messenger used to share it, the clipboard.
- **Browser history keeps the key.** When you open a room link (typed or clicked), the browser saves the full link, including the part after `#`, before melty can remove it from the address bar. We measured this in Edge 154 and Chrome 154 (`scripts/history-check.mjs`): the link stays in the profile's History database, favicon cache and session-restore files until you clear them. Anyone who can read your browser profile can recover the key and use it while the room is still open. If they have recorded the encrypted traffic, they can also read it afterwards. Opening melty and pasting the link into "join a room" avoids this. The join field is cleared before it's used and is not a form submit, so neither browser keeps it: in our measurement, both profiles held the key nowhere (headless Edge and Chrome; other browsers and private windows weren't measured).
- The server / Cloudflare seeing metadata:
  - IP addresses
  - connection times
  - the number of people in a room
  - the room id (not secret, and it doesn't reveal the key; sent in a request header, not in the URL)
  - message sizes and timing
  
  The relay writes no logs, but the data passes through Cloudflare.
- A malicious relay dropping, delaying, reordering or **replaying** messages within a room. There is no replay protection or padding in phase 1. The relay cannot read or forge messages.
- **Burn after reading is a courtesy, not a guarantee.** It removes the message from screens running this app. It can't stop screenshots, a modified client, or someone copying the text in the 10 seconds it is open.
- **Typing notices and reactions are encrypted, but they are extra traffic.** The relay can see that someone in the room is active, though not what they type or which emoji they picked.
- **Reactions show nicknames, and nicknames are not verified.**
- (Phase 2) A malicious relay running a man-in-the-middle on the key exchange, if users don't compare the safety code.
- Memory wiping in JavaScript is best effort. The secret's bytes are zeroed, but the garbage collector decides when the rest actually disappears.

## Further reading

- [SPEC.md](SPEC.md): the owner's spec and hard rules.
- [AUDIT.md](AUDIT.md): an internal check of the code against the spec, item by item. It is a self-review, not an independent audit.
- [ASSUMPTIONS.md](ASSUMPTIONS.md): every choice made that the spec didn't pin down.
- [HIGGSFIELD.md](HIGGSFIELD.md): generated images, prompts and credits used.

> **Note:** `docs/token/` is internal research. Remove it from the repo before ever making the repository public.

## Contributing

Want to help? Start with [CONTRIBUTING.md](CONTRIBUTING.md): setup, the checks to run, the project structure, and the hard rules every change must follow. Pull requests go against `main` and need a green CI run.
