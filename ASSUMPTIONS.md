# Assumptions and choices

These are the choices made where the spec left room. Items marked *(approved)* were agreed before phase 1 started.

## Project

- **Name.** `melty`, chosen 2026-10-08 on request ("geef het een goede naam"), after a quick search turned up no existing chat product with that name. Packages `@melty/web` and `@melty/relay`, worker `melty-relay`.
- **pnpm.** Installed via `npm i -g pnpm`, because `corepack enable` had no write access to `Program Files` on the dev machine. It is pinned in `packageManager`.
- **Shared protocol.** The wire protocol lives in `relay/src/protocol.ts`, and `web` imports it through an alias (`@relay/protocol`). There is no third `shared` package, so the spec's two-package layout stays intact.
- **Test tooling.** `@cloudflare/vitest-pool-workers` turned out to be deprecated and renamed to `@cloudflare/vitest-plugin`; the relay tests use the new package. Vitest is pinned at 4.1 because the plugin requires it.

## Crypto

- **HKDF salt.** 32 zero bytes, the RFC 5869 default. The input is already a uniformly random 32-byte secret, so a salt adds nothing, and a fixed one keeps derivation reproducible from the link alone.
- **roomId.** All 32 bytes of HKDF output, base64url (43 characters). The same bytes are the AES-GCM additional data.
- **Inner message format.** `{v:1, kind, nick, text?, prev?, ts}` with `kind` ∈ `chat | join | leave | nick`. This extends the spec's `{nick, text, ts}` so that system events are encrypted the same way chat is.
- **No replay protection or padding in phase 1.** *(approved)* Both limitations are documented in the threat model.
- **Secret handling.** The raw secret bytes stay in memory while the room is open, because they're needed to rebuild the share link and QR code. On wipe they are zeroed with `fill(0)`. CryptoKey objects are dropped; JS can't force them out of memory, which the threat model says.

## Relay

- **Room creation.** It's explicit: only a connection with `?create=600|3600|86400` can create a room. A join to an unknown room id gets `not_found` and creates nothing.
- **Error codes.** Rejections (not found, gone, full, limits) are sent as an accepted WebSocket that immediately sends `{t:"error",code}` and closes with a 40xx code. Browsers can't read the HTTP status of a failed upgrade, so this is the only way to tell users why.
  - All rejections go through the room's Durable Object, using the hibernation API with a `rejected` tag. A plain `accept()`ed socket closed that early made workerd report "Network connection lost".
  - Worker-level refusals (bad ttl, creation limit) reach the Durable Object through an internal `X-Relay-Reject` header. The Worker strips that header from incoming requests.
- **Expiry.**
  - At expiry everything is deleted, and then a single `goneUntil` key (expiry + 24h) is written. Without it, someone with an old link could re-create the same room. After 24h a second alarm deletes that key too.
  - A late message or join that arrives after `expiresAt`, before the alarm has run, triggers the same expiry immediately.
- **Room lifetime for joiners.** Joiners need the total lifetime to draw the melting mascot. Storage may only hold the expiry time, so the lifetime is kept on each socket's attachment (socket memory, not storage) and sent in `hello`. If nobody is connected, the relay infers it as the smallest option that's ≥ the remaining time. A 1-hour room joined with 8 minutes left by a lone person will therefore look like a 10-minute room that has barely started melting.
- **Size limit.** 4 KB applies to the plaintext JSON. The client enforces it exactly. The relay enforces the matching ciphertext size: `ceil((4096+16)·4/3)` base64url characters, plus a small frame overhead.
- **Over-limit messages.** Oversized and over-rate messages are refused with an error frame. The connection stays open.
- **Rate limit.** A token bucket per connection: 5 per second, burst 5. Its state lives on the socket attachment, which survives hibernation.
- **Room-creation limit.**
  - 20 new rooms per IP per hour, as a fixed window. *Assumption:* the spec gave no number.
  - Counters live in memory in 16 sharded `Limiter` Durable Objects. Keys are an HMAC of the IP under a random key generated in memory per instance, so even the in-memory map holds no raw IP.
  - Nothing is written to storage. An eviction resets the counters, so this is a soft limit.
- **Keepalive.** The client sends `{"t":"ping"}` every 30 seconds. The runtime answers it via `setWebSocketAutoResponse` without waking the Durable Object.
- **Origin check.** The Worker refuses WebSocket upgrades whose `Origin` isn't in `ALLOWED_ORIGINS`. This stops other websites from using the relay from a browser. Non-browser clients can still fake the header.
- **No logs.**
  - Workers observability is off, and there are no logging calls.
  - `wrangler dev` prints its own request lines by default, which would include the room id in the path. The dev script therefore runs with `--log-level warn`.

## Client

- **Fragment.** It is read once and then removed from the address bar with `history.replaceState`. *(approved)* A refresh therefore loses the room, which fits "temporary". The creator's address bar never contains the secret at all.
- **Connection loss.** The client reconnects up to 3 times (1s, 2s, 4s) with the in-memory key while the room hasn't expired. After that it wipes and returns home.
- **Local expiry.** If the relay's `expired` message never arrives, the client melts the room itself 1.5s after the server-clock expiry.
- **Tab closing.** On `pagehide` the client sends an encrypted `leave` notice (best effort) and wipes. When a page is restored from the back/forward cache, it shows the start screen.
- **Joining.** Late joiners see nothing sent before they joined. There is no history by design, and the empty chat says so.
- **Invite sheet.** It opens automatically for the creator once the room is live.
- **Nicknames.**
  - Generated from small adjective and animal lists written for this project.
  - Up to 32 characters; control and format characters are stripped.
  - Not stored anywhere, and not verified.
- **QR code.** Built with `qrcode`'s `create()` and drawn as a single SVG path. That avoids `data:` URLs and `innerHTML`, so the CSP can stay at `img-src 'self'`.

## Security headers / CSP

- **Production headers.** `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self' <relay>; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'`. They also include `X-Frame-Options: DENY` and `Cross-Origin-Opener-Policy: same-origin`, which go beyond the spec but are harmless.
- **Where it applies.** The strict CSP is enforced in `vite preview` and in production (`_headers` for Pages, generated `vercel.json`). The Vite **dev** server runs without a CSP, because its hot reload injects inline scripts.
- **React inline styles.** React sets `style` through the CSSOM, which `style-src 'self'` allows. The e2e test confirms there are no CSP violations.
- **Inlining.** The Vite build sets `assetsInlineLimit: 0` and turns off the modulepreload polyfill. As a result there are no `data:` URIs and no inline scripts.

## Design

- **Font.** Quicksand (SIL OFL), a rounded geometric sans. It is installed from npm (`@fontsource-variable/quicksand`) and bundled into `web/dist`, so it is served from our own origin and not from a CDN. The fallback stack is `ui-rounded`, `SF Pro Rounded`, `Nunito`, `system-ui`.
- **Mascot.** Higgsfield variant A was chosen and hand-redrawn as SVG in `web/src/ui/Mascot.tsx`. Variant B and the raw outputs are kept in `web/design-src/` as reference; they are not shipped.
- **Melting.**
  - The cube scales to 55% of its width and 28% of its height. The face counter-scales so it stays round, and the base spreads into a "skirt".
  - The puddle grows from 35% to 110% of its size.
  - Drips appear after 3% of the lifetime.
  - A sweat drop appears at 40% left, and the smile turns at 25%.
  - At 0 only steam is left.
  - Everything is driven by the server-corrected countdown.
- **Reduced motion.** `prefers-reduced-motion` turns off every animation and transition. The melt state still shows, as static steps.
- **Condensation.** A faint droplet texture on panels gets stronger on hover and focus.
- **Light mode.** It follows `prefers-color-scheme`; dark is the default.
- **OG image.** It has no text; the name can be composited on later. `og:image` uses `VITE_PUBLIC_ORIGIN`, because crawlers need an absolute URL.

## Frontend redesign (2026-10-08)

- **How it was built.** Seven parallel agents built the landing page, the room UI and the how-it-works page. Each owned its own files: mascot/logo, hero, scroll story, explainer cards, flood + finale, room, how-it-works. The shared brief held them to the hard rules: no external resources, the strict CSP, honest claims only, reduced motion, accessibility, 390–1440px, dark + light.
- **Inspiration.** The layout energy of a long storytelling scroll (usepoof.chat was the reference). No text, names, images or art style were copied; the identity is our own ice/melt theme.
- **Bundle check.** `scripts/check-bundle.mjs` now allows CSS `url(#id)` references. Those point at SVG filters inside the page itself, not at external resources.
- **e2e selectors.** `scripts/e2e-smoke.mjs` targets `#start`'s button, because "open a room" now appears three times on the landing page.
- **Viewport.** `interactive-widget=resizes-content` is set so the chat composer stays above the Android keyboard.

## Phase 3 features (2026-10-08)

The five features below were chosen on request: "voeg 5 nieuwe dingen toe, technisch".

- **Creator proof.**
  - The creator gets a second random 32-byte secret, kept in memory. The relay only gets its SHA-256, sent as `?owner=` when the room is created.
  - `lock` and `melt` control frames carry the secret. The relay hashes it and compares.
  - The hash and the locked flag are copied onto every socket's attachment (socket memory). They are never written to storage, so the "only the expiry time in storage" rule still holds.
  - Consequence: an empty room loses its owner, and a joiner can't claim ownership of an empty room.
  - When the creator reconnects to a locked room, it passes the hash to get back in. Only the creator's browser and the relay know that hash.
- **Melt now.**
  - It runs the same wipe as expiry: close everyone with code 4002, delete storage, and keep the 24-hour tombstone, measured from the original expiry.
  - The others see "the creator melted the room."
  - The button needs a 1.5 s press and hold (mouse, touch or keyboard) so it can't be triggered by accident.
- **Lock.**
  - Newcomers get the error `locked` (close code 4023).
  - Everyone inside gets a `locked` frame and an in-room notice.
- **Burn after reading.**
  - The message has a `burn: true` flag inside the ciphertext.
  - Receivers see a frozen bubble. Opening it starts a 10 s countdown, then a drip-away animation, then the line is removed from memory.
  - The sender's own copy goes 10 s after sending.
  - It's documented as a courtesy, not a guarantee.
- **Typing.**
  - An encrypted `typing` notice is sent at most every 3 s while typing, and shown for 4.5 s.
  - It is cleared when that person's message arrives or they leave.
- **Reactions.**
  - Every chat message now carries a random 8-byte `id` inside the ciphertext.
  - `react` messages reference it, with a fixed set of four emoji and an on/off toggle.
  - Reactions are keyed by nickname, which is unverified.
- **Bug found while building this.** The message pool used `overflow: hidden` while its water layer is translated down out of it. That made the pool scrollable, and focusing a button inside it scrolled the whole pool up. It's now `overflow: clip`.
