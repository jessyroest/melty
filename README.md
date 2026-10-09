# melty

Temporary chat rooms, no account needed. You open a room, share the link (or QR code, or 4 words), and talk. When the timer runs out, the room melts: the relay closes every connection and deletes the room, and every browser wipes its messages and keys.

Messages are **end-to-end encrypted** (AES-256-GCM). The link doesn't carry the room key: someone inside hands it to a newcomer through a **hybrid post-quantum key exchange** (X25519 + ML-KEM-768). The relay only ever sees a room id and ciphertext, and it stores nothing except when the room expires (and, for the 4 words, which room they point to).

> Status: phases 1, 2 and 3 are done, and so is the finishing round (PWA, OG image, Lighthouse, accessibility).
> melty has **not been independently audited**. The security properties below are what the code is designed and tested to do, not the result of an outside review.

## Features

- Rooms that melt after 10 minutes, 1 hour or 24 hours. Share them by link, QR code or **4 words**.
- **Post-quantum key exchange.** The room key reaches newcomers through X25519 + ML-KEM-768, never through the link.
- **4 words** (EFF short wordlist) to say out loud. They only find the room: someone inside has to let you in, and you both compare **6 safety words**.
- **Replay protection and padding.** Each sender's messages carry a counter, and every message is padded to one of three sizes.
- **Installable (PWA).** The service worker caches the app itself, never messages.
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
| `pnpm e2e:phase2` | same setup. 4 words, a knock let in, matching safety words, a link join answered by a member who isn't the creator, and on the wire: only padded sizes, no plaintext |
| `pnpm e2e` | needs the relay and `preview` running. Two real browser sessions chat through the relay. Also checks: the fragment leaves the address bar; no web storage, cookies or IndexedDB are used; no request leaves our origin + relay; no CSP violations |
| `pnpm typecheck` | `tsc --noEmit` for web and relay |
| `pnpm check` | lint + typecheck + test + build + check:bundle + check:logs |

The e2e tests use your locally installed Edge (`BROWSER_CHANNEL=chrome` for Chrome, or `BROWSER_PATH=/path/to/chromium` for any Chromium binary) through `playwright-core`. Nothing is downloaded.

`node scripts/brand-images.mjs` rebuilds the OG image and the app icons from sources in the repo, with the same local browser.

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
4. Upgrading an existing deploy: the `v2` migration adds the `Door` Durable Object class (the 4 words). `wrangler deploy` applies it.

### Web → Cloudflare Pages

Build settings:

- root directory: `web`
- build command: `pnpm build`
- output directory: `dist`
- environment variables:
  - `VITE_RELAY_URL=wss://melty-relay.<account>.workers.dev`
  - `VITE_PUBLIC_ORIGIN=https://<your pages domain>`

The build writes `dist/_headers` with the CSP (`connect-src` set to your relay, `worker-src 'self'` for the service worker), `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and a `Permissions-Policy` that turns off camera, microphone and geolocation. Pages serves `index.html` for `/r` and `/how` by itself.

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

1. **Opening a room.** The browser generates three random values (`crypto.getRandomValues`):
   - a 32-byte **room key** (AES-256-GCM, imported non-extractable; the raw bytes stay in memory only to hand to newcomers),
   - a 32-byte **link secret**, which goes in the link after the `#`: `/r#<secret>`. Browsers don't send the fragment to servers, and the creator's own address bar never shows it,
   - **4 words** from the EFF short wordlist (1296 words, so 1296⁴ ≈ 2⁴¹ combinations).
2. **Deriving.** HKDF-SHA256 over the link secret derives:
   - `roomId` (`info="room-id-v1"`): sent to the relay.
   - a **pre-shared key** (`info="link-psk-v1"`): proves you were given the link. It never leaves the browser.
3. **Getting the key (link).** A newcomer with the link connects to the room and asks for the key. Someone inside (the creator at once, any other member after a moment, unless someone already did) answers with fresh X25519 and ML-KEM-768 keys. The newcomer does X25519 ECDH and ML-KEM encapsulation, and both sides compute
   `shared = HKDF(x25519_ss ‖ mlkem_ss, salt = SHA-256(transcript), info = "pq-hybrid-v1")`.
   The newcomer proves it holds the link with a MAC over the transcript (keyed from the psk), and the key that seals the room key mixes in the psk too, so the relay can't sit in the middle. The room key, the link secret and the 4 words travel AES-GCM-sealed with that key (`crypto/kx.ts`).
4. **Getting the key (4 words).** The words are not a key: the relay maps them to the room (a `Door` object that stores the room id until expiry). A knock lands in the room's **lobby**: it can exchange key-exchange frames with the members and nothing else, never sees messages, and isn't counted as a person. A person inside has to press "let in". Then the same exchange runs without a psk, and both sides see **6 safety words** from `SHA-256("melty-safety-v1" ‖ transcript)`. If the relay sat in the middle, the two sides see different words.
5. **Messages.** Chat messages and join / leave / nickname / typing / reaction notices are JSON, padded to 256, 1024 or 4352 bytes, and encrypted with a fresh random 12-byte IV. In front of the ciphertext, in the clear and in the AAD, go an 8-byte random sender id and a 32-bit counter; the AAD is `"melty-msg-v2" ‖ roomId ‖ sender ‖ counter`. A receiver drops anything whose counter isn't higher than the last one it saw from that sender. The relay receives `{iv, ct}` and nothing else, and refuses any ciphertext length that isn't one of the three padded sizes.
6. **Transport.** The browser connects to the fixed path `wss://<relay>/ws`. Everything about the room travels in the `Sec-WebSocket-Protocol` header, never in the URL: `melty.v1, r.<roomId>[, c.<ttl>][, o.<hash>][, w.<words>]` to join or create, or `melty.v1, w.<words>` to knock. The words travel as word indices (`w.12-345-6-1295`). The relay answers with `Sec-WebSocket-Protocol: melty.v1`.
7. **Relay.** One Durable Object per room, plus one `Door` object per set of words. It forwards ciphertext to the other members and key-exchange frames to the socket they're addressed to, and stores only `expiresAt`, `owner` (the SHA-256 of the creator's random owner secret, never the secret itself, so the creator keeps lock and melt after a reconnect into an empty room) and `locked` while the room is locked (the Door: the room id, until `expiresAt`). All of it is deleted at expiry. It also enforces these limits:

   | limit | value |
   |---|---|
   | people per room | 8 |
   | plaintext per message | 4 KB |
   | messages per connection | 5 per second |
   | messages per room, all connections together | 20 per second (burst 20; in the room object's memory, never stored) |
   | connection attempts per IP (joins, creates, reconnects, knocks) | 60 per minute |
   | knocks with 4 words per IP | 10 per minute |
   | knocks waiting per room | 4 (older than 3 minutes are closed) |
   | new rooms per IP | 20 per hour |

   Per-IP counts are kept in memory under an HMAC of the address with a random per-instance key, and never stored. Over the connection limit a socket is refused with `slow` (close code 4031).

8. **Expiry.** At `expiresAt` an alarm fires. It sends `expired` and closes every socket, then deletes all state. For 24 hours afterwards a tombstone refuses the room id, and then the tombstone is deleted too. The Door's own alarm deletes the words at the same moment.
9. **Creator controls.**
   - The creator's browser makes a second random 32-byte secret and gives the relay only its SHA-256.
   - The relay keeps that hash, and the room's locked flag, on the open sockets in memory, never in storage.
   - To lock or melt, the creator sends the secret itself; the relay checks it against the hash. Locking also sends waiting knocks away.
   - When the room has nobody in it, the creator rights are gone, and a later joiner can't claim them.
10. **Client.** The client keeps everything in memory only. Expiry, leaving or closing the tab wipes the secrets (zeroed), the keys and the messages, and returns to the start screen. The countdown uses the relay's clock.
11. **Offline cache.** A service worker (`web/sw.template.js`) precaches the built app (HTML, scripts, styles, fonts, images) so the start screen opens fast. It only answers same-origin GETs for those files; it never sees WebSocket traffic, and the `#` part of a link never reaches it.

## Threat model

This threat model has **not been independently audited**. It describes what the code is built to do; no outside party has reviewed or tested it.

**Protects against**

- **The server reading messages.** The relay never has the key, only `roomId` + ciphertext, and the public halves of key exchanges.
- **Stored chat history.** Nothing is stored on the server. Clients keep messages in memory only and drop them when the room ends.
- **Later decryption of recorded traffic, including by a future quantum computer.** The room key never travels in the link. It travels sealed under a hybrid X25519 + ML-KEM-768 exchange with fresh keys per join, so breaking X25519 alone isn't enough. A link that turns up after the room melted (browser history, a chat log) opens nothing.
- **A relay in the middle of a link join.** Both sides mix in the link's psk; the relay doesn't have it. Tests: "link mode: a man in the middle without the psk is refused", "a bundle sealed by someone without the psk doesn't open".
- **A relay in the middle of a words join, if the 6 safety words are compared.** A man in the middle gives each side a different transcript, and so different words (test "a man in the middle (code mode) ends up with a different safety code on each side").
- **Replays to someone who already got the message.** Per-sender counters in the AAD.
- **Message sizes.** Padding to three fixed sizes: a typing notice and a short line look the same.

**Does not protect against**

- Screenshots, or photos of the screen.
- Compromised devices, or malicious browser extensions.
- **Someone forwarding the link.** While anyone is inside, whoever has the link is handed the key automatically and can post under any nickname, including fake join, leave and rename notices. Nicknames are not verified.
- **Skipping the safety words.** The relay knows the 4 words (it maps them). If a knock is let in and nobody compares the 6 words, the knocker could be the relay itself, or the relay could sit in the middle. Guessing the words: 2⁴¹ combinations at 10 tries per minute per IP, and a guess only gets someone to the door.
- Where the link travels: the messenger used to share it, the clipboard.
- **Browser history keeps the link.** Opening a room link (typed or clicked) saves the full link, including the part after `#`, before melty can remove it from the address bar. We measured this in Edge 154 and Chrome 154 (`scripts/history-check.mjs`): it stays in the profile's History database, favicon cache and session-restore files until you clear them. Since phase 2 the link no longer holds the room key, but anyone who can read your browser profile can use it to get in while the room is still open, and then also read traffic they recorded earlier. Pasting the link into "join a room" avoids this (measured in headless Edge and Chrome; other browsers and private windows weren't measured).
- **One key per room.** Everyone who gets in while the room is open has the same key, including for messages sent before they arrived, if they recorded them. There is no re-keying when someone leaves.
- The server / Cloudflare seeing metadata:
  - IP addresses
  - connection times
  - the number of people in a room, and how many are knocking
  - the room id and the 4 words (not secret; they don't reveal the key; sent in a request header, not in the URL)
  - message timing, and sizes in three steps
  
  The relay writes no logs, but the data passes through Cloudflare.
- A malicious relay dropping, delaying or reordering messages, or replaying old messages to someone who joined after they were sent (that person has no counter to compare with yet; the relay can't read or forge them).
- **Burn after reading is a courtesy, not a guarantee.** It removes the message from screens running this app. It can't stop screenshots, a modified client, or someone copying the text in the 10 seconds it is open.
- **Typing notices and reactions are encrypted, but they are extra traffic.** The relay can see that someone in the room is active, though not what they type or which emoji they picked.
- **Reactions show nicknames, and nicknames are not verified.**
- Memory wiping in JavaScript is best effort. The secrets' bytes are zeroed, but the garbage collector decides when the rest actually disappears.

## Further reading

- [SPEC.md](SPEC.md): the owner's spec and hard rules.
- [AUDIT.md](AUDIT.md): an internal check of the code against the spec, item by item. It is a self-review, not an independent audit.
- [ASSUMPTIONS.md](ASSUMPTIONS.md): every choice made that the spec didn't pin down.
- [HIGGSFIELD.md](HIGGSFIELD.md): generated images, prompts and credits used.

> **Note:** `docs/token/` is internal research. Remove it from the repo before ever making the repository public.

## Contributing

Want to help? Start with [CONTRIBUTING.md](CONTRIBUTING.md): setup, the checks to run, the project structure, and the hard rules every change must follow. Pull requests go against `main` and need a green CI run.
