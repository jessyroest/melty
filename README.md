# PROJECTNAAM

Temporary chat rooms, no account needed. You open a room, share the link (or QR code), and talk. When the timer runs out, the room melts: the relay closes every connection and deletes the room, and every browser wipes its messages and keys.

Messages are **end-to-end encrypted** (AES-256-GCM). The relay only ever sees a room id and ciphertext, and it stores nothing except when the room expires.

> Status: phase 1 (MVP). The 4-word codes and the hybrid key exchange (phase 2) are not built yet.

```
web/     Vite + React + TypeScript client (UI in English)
relay/   Cloudflare Worker + Durable Objects (one per room, WebSocket Hibernation API)
scripts/ bundle / log checks and a browser end-to-end smoke test
```

## Run locally

Requirements: Node 20+ (tested on 24) and pnpm 10.

```sh
pnpm install
pnpm dev
```

- web: http://localhost:5173
- relay: ws://localhost:8787

`pnpm dev` starts both. The Vite dev server runs **without** the strict CSP, because hot reload needs inline scripts. To try the app with the real production headers:

```sh
pnpm build
pnpm --filter @projectnaam/relay dev      # terminal 1
pnpm --filter @projectnaam/web preview    # terminal 2 → http://localhost:4173
```

To test with two people, open the room link in a second browser or a private window. A second tab in the same window also works, because nothing is shared between tabs.

### Tests and checks

| command | what it checks |
|---|---|
| `pnpm test` | web: crypto (AES-GCM roundtrip; wrong key / tampered ciphertext / IV / AAD fail; HKDF determinism; roomId doesn't leak the secret). relay (in workerd via `@cloudflare/vitest-plugin`): forwarding, nothing stored, expiry + refusal afterwards, every limit, origin check, and **no console output during a full room lifecycle** |
| `pnpm check:logs` | no logging calls in `relay/src`, Workers observability off, no logpush / tail consumers |
| `pnpm build && pnpm check:bundle` | the built bundle references only our own origin and the relay: no external URLs, no inline scripts/styles, no `data:` URIs |
| `pnpm e2e` | needs the relay and `preview` running. Two real browser sessions chat through the relay. Also checks: the fragment leaves the address bar; no web storage, cookies or IndexedDB are used; no request leaves our origin + relay; no CSP violations |
| `pnpm check` | test + build + check:bundle + check:logs |

The e2e test uses your locally installed Edge (`BROWSER_CHANNEL=chrome` for Chrome) through `playwright-core`. Nothing is downloaded.

## Deploy

### Relay → Cloudflare Workers

1. In `relay/wrangler.jsonc`, set `ALLOWED_ORIGINS` to your web origin(s), for example `https://projectnaam.pages.dev`.
2. Deploy:
   ```sh
   cd relay
   npx wrangler login
   pnpm deploy
   ```
   Note the URL, e.g. `https://projectnaam-relay.<account>.workers.dev`. The app connects to it as `wss://…`.
3. Leave observability **off**; `pnpm check:logs` fails if it's on. Don't add Logpush or tail workers.

### Web → Cloudflare Pages

Build settings:

- root directory: `web`
- build command: `pnpm build`
- output directory: `dist`
- environment variables:
  - `VITE_RELAY_URL=wss://projectnaam-relay.<account>.workers.dev`
  - `VITE_PUBLIC_ORIGIN=https://<your pages domain>`

The build writes `dist/_headers` with the CSP (`connect-src` set to your relay), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and a `Permissions-Policy` that turns off camera, microphone and geolocation. Pages serves `index.html` for `/r` and `/how` by itself.

### Web → Vercel (alternative)

```sh
VITE_RELAY_URL=wss://projectnaam-relay.<account>.workers.dev pnpm --filter @projectnaam/web gen:vercel
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
4. **Relay.** One Durable Object per room. It forwards ciphertext to the other sockets and stores only `expiresAt`. It also enforces these limits:

   | limit | value |
   |---|---|
   | people per room | 8 |
   | plaintext per message | 4 KB |
   | messages per connection | 5 per second |
   | new rooms per IP | 20 per hour (counted in memory under an HMAC with a random per-instance key; never stored) |

5. **Expiry.** At `expiresAt` an alarm fires. It sends `expired` and closes every socket, then deletes all state. For 24 hours afterwards a tombstone refuses the room id, and then the tombstone is deleted too.
6. **Client.** The client keeps everything in memory only. Expiry, leaving or closing the tab wipes the secret (zeroed), the key and the messages, and returns to the start screen. The countdown uses the relay's clock.

## Threat model

**Protects against**

- **The server reading messages.** The relay never has the key, only `roomId` + ciphertext.
- **Stored chat history.** Nothing is stored on the server. Clients keep messages in memory only and drop them when the room ends.
- **Later decryption of recorded traffic, as long as the link stays secret.** Phase 1 has no key exchange: *the link is the key*. Anyone who later obtains the link and also has recorded traffic can decrypt it. Phase 2 adds a key exchange so links don't have to carry the key.

**Does not protect against**

- Screenshots, or photos of the screen.
- Compromised devices, or malicious browser extensions.
- Someone forwarding the link. Whoever has it can read along and post under any nickname. Nicknames are not verified.
- Where the link travels: the messenger used to share it, the clipboard, browser history. The app strips the fragment from the address bar right after opening, but the browser may already have recorded the visit.
- The server / Cloudflare seeing metadata:
  - IP addresses
  - connection times
  - the number of people in a room
  - the room id (not secret, and it doesn't reveal the key)
  - message sizes and timing
  
  The relay writes no logs, but the data passes through Cloudflare.
- A malicious relay dropping, delaying, reordering or **replaying** messages within a room. There is no replay protection or padding in phase 1. The relay cannot read or forge messages.
- (Phase 2) A malicious relay running a man-in-the-middle on the key exchange, if users don't compare the safety code.
- Memory wiping in JavaScript is best effort. The secret's bytes are zeroed, but the garbage collector decides when the rest actually disappears.

## Further reading

- [ASSUMPTIONS.md](ASSUMPTIONS.md): every choice made that the spec didn't pin down.
- [HIGGSFIELD.md](HIGGSFIELD.md): generated images, prompts and credits used.
