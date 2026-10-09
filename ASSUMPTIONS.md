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

- **Room creation.** It's explicit: only a connection that offers a `c.<ttl>` subprotocol entry (600, 3600 or 86400) can create a room. A join to an unknown room id gets `not_found` and creates nothing.
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
  - The creator gets a second random 32-byte secret, kept in memory. The relay only gets its SHA-256, sent as the `o.<hash>` subprotocol entry when the room is created.
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

## Contributor setup (2026-10-08)

- **Node version.** `.nvmrc` and CI use Node 22, and CONTRIBUTING.md asks for 22+, because `wrangler` 4 declares `node >= 22`. The README's "Node 20+" predates this check.
- **CI browser.** The e2e job runs with `BROWSER_CHANNEL=chrome`, using the Google Chrome that GitHub's `ubuntu-latest` runner image ships with. Nothing is downloaded by Playwright.
- **CI actions.** Pinned to major tags: `actions/checkout@v7`, `pnpm/action-setup@v6` (pnpm version from `packageManager`), `actions/setup-node@v7` with the pnpm cache. Wrangler metrics are turned off in CI.
- **Server output in CI.** The relay and preview output go to files in the runner's temp folder and are only printed when a step fails. The relay runs with `--log-level warn`, so room ids don't appear there.

## Repo hardening: pinning, lint, Dependabot, secrets scan (2026-10-08)

- **Exact versions.** Every `^`/`~` range in the three `package.json` files was replaced by the exact version already in `pnpm-lock.yaml`. Nothing resolved differently; `pnpm install --frozen-lockfile` passes. New dev dependencies are added with `pnpm add -E`.
- **ESLint 10 with an unmet peer.** We use ESLint 10.12.0 because ESLint 9 is marked "no longer supported" on npm. `eslint-plugin-jsx-a11y` 6.10.2 (the latest, from 2024) still declares `eslint <= 9` as its peer, so pnpm prints a peer warning. Its rules work on ESLint 10: it uses none of the context APIs that ESLint 10 removed. Revisit when jsx-a11y ships a release for ESLint 10.
- **ESLint config.** `eslint.config.mjs` (not `.js`, so the root `package.json` doesn't need `"type": "module"`). It is not type-aware (`typescript-eslint` "recommended"), for speed. `globals` was added as a dev dependency for browser, Node and Workers globals. The e2e scripts get browser globals too, because their `page.evaluate` callbacks run in the page. `interface Env extends Cloudflare.Env {}` is allowed (the standard Workers pattern). Empty `catch {}` blocks are allowed in Node scripts only.
- **Lint warnings are debt, not style.** The rules that fired on the existing code when ESLint was added are downgraded to `warn` in a `TODO(lint)` block (react-hooks `set-state-in-effect` / `purity` / `refs`, three jsx-a11y rules, `prefer-const`; `exhaustive-deps` is a warning by default). The goal is to fix them and promote the rules back to `error`. `no-console` is an error in `relay/src`.
- **`pnpm check` now also runs `pnpm lint` and `pnpm typecheck`** (web and relay). `web/package.json` got a `typecheck` script for that.
- **Dependabot** watches only the root directory: Dependabot reads `pnpm-workspace.yaml` from there and updates `web/` and `relay/` too. Listing them separately would give duplicate PRs against the one lockfile. Minor and patch bumps come as one grouped PR per week; majors each get their own PR.
- **gitleaks-action `@v3`, not `@v2`.** v3 is the current release (Node 24 runtime, same inputs). It's free for repos on a personal account. An organization repo needs a free `GITLEAKS_LICENSE` secret; the workflow already passes it through, empty if unset. It needs `GITHUB_TOKEN` for API calls. PR comments and the report artifact are switched off: comments would need `pull-requests: write`, and the raw report would contain the leaked value.

## Relay transport and extra limits (2026-10-08)

- **Nothing about a room in the URL.** The client connects to the fixed path `/ws`. The room id, the ttl of a create and the owner hash travel in the `Sec-WebSocket-Protocol` header: `melty.v1, r.<roomId>[, c.<ttl>][, o.<ownerHash>]`. Every entry is an HTTP token (base64url plus `.`, all RFC 7230 `tchar`s), so browsers accept it. The constants live in `relay/src/protocol.ts` (`WS_PATH`, `SUBPROTOCOL`, `PROTO_*`) and are shared with the web client.
- **The 101 always selects exactly `melty.v1`**, for accepted sockets and for refusals (which are also 101s, so the browser can read the reason). Without it browsers fail the handshake. Set through the `headers` of the `Response` that carries the `webSocket`; checked in the relay tests and in Edge against `wrangler dev`.
- **Strict parsing (`relay/src/offer.ts`).**
  - Plain `400`, no socket: no header, header over 256 chars, `melty.v1` missing or offered twice, no `r.` entry or more than one, or a room id that isn't 43 base64url chars. Without a room id there is no room object to answer through, and a client that doesn't offer `melty.v1` isn't ours.
  - `101` + error `bad`: a valid room id, but an unknown, empty or repeated entry, a ttl that isn't spelled exactly `600`, `3600` or `86400`, or an owner that isn't 43 base64url chars.
  - Entries may come in any order; whitespace around commas is ignored.
  - `/ws` with any query string is a `400`; the old `/rooms/<id>/ws` path is a `404`.
- **Internal headers.** The worker passes the validated ttl and owner hash to the room object as `X-Relay-Create` / `X-Relay-Owner` (next to the existing `X-Relay-Reject`). It forwards a fresh header set without any client header starting with `x-relay-`, and without `Sec-WebSocket-Protocol`, so the room object only ever trusts what the worker validated.
- **Connection attempts per IP: 60 per minute.** A token bucket (burst 60, refills one per second) in the existing `Limiter` object, under the same HMAC-with-a-random-per-instance-key scheme; never stored. Every WebSocket attempt to `/ws` that carries a usable room id counts: joins, creates, reconnects and refusals. It is checked before the room object is touched. Over the limit the socket gets error `slow` (close code 4031). One Limiter round trip handles both this and the 20-rooms-per-hour create limit; a refused attempt is not counted as a creation. 60/min leaves room for a full room of 8 behind one NAT reconnecting a few times, and stops one address from hammering the relay. Plain 400/403/404/426 answers are not counted: they never reach a Durable Object.
- **A room's message budget: 20 per second, burst 20,** shared by all sockets of a room, on top of the 5/s per connection. Over budget the sender gets `{t:"error",code:"rate"}` and nothing is forwarded. The bucket is a field on the room object, in memory only. Hibernation or eviction resets it to full, which is acceptable: a room object only hibernates after it has been idle for a while, by which time the bucket would have refilled anyway. Every frame that reaches the room object counts (messages, control frames, malformed frames); keepalive pings don't, because the runtime answers them without waking the object.
- **Client events.** `RelayConnection` reports `{type:"unreachable"}` instead of `{type:"closed"}` when the socket closes without ever having opened (handshake refused, network down, relay offline). A refusal by the relay still opens first and arrives as an `error` frame, then `closed`. `sendRaw(frame)` sends a pre-built frame synchronously if the socket is open.
- **Shared IP in local dev.** All local browsers reach `wrangler dev` from the same address, so parallel e2e runs share one 60/min bucket. The relay tests give every connection a random address unless a test sets one.

## Mobile pass (2026-10-09)

- **Tested with** playwright-core in the local Edge with mobile emulation (`isMobile`, `hasTouch`, DPR 3) at 360×740, 390×844, 414×896 and 844×390 landscape, dark and light, plus 1440 desktop. WebKit isn't available here, so iOS Safari behaviour is reasoned about, not measured.
- **Touch targets.** Under `(pointer: coarse)` every control is at least 44×44. Small chips that would look heavy at 44px (nickname chip, reaction chips, the nickname save button) keep their look and get an invisible `::after` hit area. Inline text links inside sentences are left as they are (WCAG 2.5.8 exempts them).
- **Reacting on a phone.** Phones can't hover, so a tap anywhere on a bubble opens the reaction picker (only under `(hover: none)`, and not when the tap ends a text selection, so long-press still selects and copies text). The small react button stays for keyboard and screen readers. The picker scrolls itself into view.
- **Controls vs. text.** Buttons get `touch-action: manipulation`, no tap highlight, no long-press callout and no text selection. Message text stays selectable.
- **No iOS input zoom.** Inputs and textareas are at least 16px on coarse pointers.
- **Nav on phones.** "join a room" is no longer hidden: below 560px its visible label shortens to "join" through CSS (the accessible name stays "join a room", which contains the visible label, so WCAG 2.5.3 holds). Up to 440px the wordmark hides and the cube alone is the home link (its accessible name stays "melty"); the room keeps the wordmark. Nothing wraps or overlaps at 360–440px.
- **iOS keyboard.** iOS Safari ignores `interactive-widget=resizes-content`. While the keyboard is open (`visualViewport` more than 80px shorter than the layout viewport) `Chat.tsx` sets `--room-h` to the visual viewport height and scrolls to the top, so the composer sits right above the keys. On Android the layout viewport shrinks itself and this is a no-op.
- **Safe areas.** The top nav pads for the notch, the nav, the how-it-works page and the landing page pad for landscape side insets, and the room already padded for the home bar.
- **Sheets on phones** are bottom sheets with a grab handle; a swipe down of more than 90px (while the sheet is scrolled to its top) closes them, and so does a tap on the backdrop. The share sheet puts the link, copy and share buttons first and the QR code (up to 248px) below them; in landscape the QR is capped at 200px.
- **Short landscape screens** get a one-row room bar, icon-only creator buttons, and the nickname chip next to the message field, so the log keeps some height.
- **Cheaper glass.** On phones the frosted-panel blur goes from 16px to 10px, and the room panels drop `backdrop-filter` altogether: only the plain page background is behind them, so the blur cost GPU time and showed nothing. The share sheet's backdrop is a darker scrim instead of a blur.
- **Reduced motion** was verified in the browser: with `reducedMotion: "reduce"` there are no running CSS animations or transitions on the landing page (scrolled through), how-it-works, the share sheet or the room, and the frost canvas draws one still frame.
- **User text and bidi.** Message text, nicknames (group header, nick chip, typing indicator, system notices) are wrapped in `<bdi>` / `unicode-bidi: isolate`. Reaction tooltips and aria-labels, which are attributes, wrap nicknames in U+2068/U+2069 (first-strong isolate). Bubbles clip zalgo marks (`overflow: hidden`) and break long strings (`overflow-wrap: anywhere`); rows in the log never shrink (`flex-shrink: 0`), which also fixed system notices being squashed to a sliver once the log overflowed. `scripts/e2e-xss.mjs` checks all of this.
- **Claim wording.** "messages never stored" → "messages never stored on the server" (hero chip); footer "no logs" → "the relay keeps no logs"; the explainer card "nothing is kept" → "no messages stored"; how-it-works "no logs" → "no relay logs", plus "not independently audited (yet)" in the hero and the spec table. The spec table's limits and room-id line were updated for the new transport (WebSocket header, 20 msg/s per room, 60 connection attempts per IP per minute).
- **Burn after reading in the room UI.** The frozen bubble says "best effort: a screenshot still keeps it"; the burn toggle's tooltip and description say "best effort: the reader can still take a screenshot", and while it's on, the composer shows "burns after reading · best effort".
- **Join dialog and Edge's form memory.** Edge kept the pasted room link, key included, in its form-autofill table (`Default\Web Data`) despite `autocomplete="off"`. The dialog is no longer a `<form>` (Enter in the field and the button call the same handler), and the handler reads the value, then empties the field's DOM value before doing anything else. Measured with `scripts/history-check.mjs` (`MODES=dialog`, headless): before, Edge had the secret in `Web Data`; after, no file in the Edge or Chrome profile contains it. Headed browsers and other Edge versions weren't measured.
- **Mascot steam under reduced motion.** The wisps rest at opacity 0 and only show while animating; `mascot.css` now keeps them at 0.8 under `prefers-reduced-motion` (the `app.css` rule lost on source order).

## Session: key wipe, error screens, reconnect, clock (2026-10-09)

- **Synchronous wipe.** While a room is live, the session keeps one pre-sealed "leave" frame (the encrypted goodbye as a ready JSON string). It is re-sealed with a fresh `ts` after every hello, after a nick change, and at most once a minute (checked on a 5 s tick). `pagehide` calls `wipeNow()`: send that frame with `RelayConnection.sendRaw` if the socket is open, then zero the secret and the owner secret, drop the keys and the frame, clear lines, typing and every timer, close the socket and empty the store. No `await` anywhere on that path; the explicit "leave" button uses the same code. If the frame isn't ready yet (the first milliseconds after hello), the goodbye is skipped rather than awaited. `pageshow` with `persisted` empties the store again and goes to the start screen. Unit tests in `web/src/state/session.test.ts` check, in the same tick as the call, that the secret bytes are zero, keys are null and lines are empty.
- **Error screens.** The store has `error: RoomErrorKind | null` next to `notice`. `App` shows `ui/RoomError.tsx` instead of Home or the room when it is set (on `/` or `/r`). Each kind has its own cube (steam for expired/melted, a lock badge for locked, "8/8" for full, sleepy for the rate limits, dizzy and cracked for unreachable), one honest sentence about what happened, a line about the key, and actions. Mapping: relay `not_found` → not_found; `gone` → expired ("that room already melted.", or "the room melted while you were away." after a reconnect); `expired` frame or the local expiry timer → expired; `melted` → melted for everyone except the creator, who gets the old start screen with the melt curtain (they did it themselves, it's not an error); `full`, `locked`, `limit`, `slow` → their own kinds. Leaving yourself is not an error either: plain notice on the start screen as before.
- **Key kept only for "unreachable".** If the relay never answers before the first hello (4 quick tries, ≈4–8 s), the session pauses with the key still in memory and shows "can't reach the relay" with "try again". The tab also retries by itself on `online`. Every other error screen comes after a full wipe and says so.
- **Reconnect.** After a room has been live, a dropped socket is retried with exponential backoff and equal jitter (0.25–0.5 s, doubling, capped at 5–10 s) for as long as the room hasn't expired by server time, up to a hard cap of **10 minutes without a connection**; then the key is wiped and the "lost" screen offers to rejoin with the link. `online` and the tab becoming visible retry immediately; `offline` drops the socket straight away (it is dead anyway). A `slow` refusal mid-room jumps to the slowest pace instead of ending the room. At ≤ 12 attempts a minute this stays well under the relay's 60/min per IP. The join notice is sent once per room (only marked sent when it really went out); a rename made while offline is announced after the reconnect. Messages typed while offline are still refused (the composer keeps the draft); there is no queue, so nothing can arrive twice.
- **Monotonic server clock.** At hello the session stores the server's `now` and `performance.now()`; server time is `now + (performance.now() − then)`, exposed as `session.serverNow()` and `serverNow()` from `state/session.ts`. Expiry and the reconnect decision use it. `view.offset` stays `serverNow − Date.now()`, refreshed when it drifts by more than 1 s (5 s tick), so `RoomBar`'s `Date.now() + offset` keeps working through a device clock change. Caveat: on some systems `performance.now()` doesn't advance while the machine sleeps; after a sleep the socket reconnects and the next hello re-anchors the clock, and the relay refuses a room that expired meanwhile.
- **History measurement** (`scripts/history-check.mjs`, Edge 154 and Chrome 154 on Windows, headless, fresh profiles): opening a room link, typed or clicked, leaves the full URL with `#<key>` in the `History` database, and also in `Favicons` and the session-restore files (Chrome also in `segmentation_platform/ukm_db`), even though the app strips it from the address bar at once. Pasting the link into "join a room" instead kept it out of history in both; Chrome's profile then held the key nowhere, but Edge stored the pasted text in its own form-autofill table (`autofill_edge_field_values` in `Web Data`), despite `autocomplete="off"` on the field.

## Phase 2: words, key exchange, safety words, replay counter, padding (2026-10-09)

The owner asked to "finish it", which covered the rest of the lock-down round (phase 2, then step 4). There was no separate plan approval for this round; the choices below are the ones the spec didn't pin down.

- **The link no longer carries the room key (spec 2.3, "optionally").** Taken, for every link. The room key is 32 random bytes made by the creator. The link carries a 32-byte *link secret*: HKDF gives the room id (`room-id-v1`, unchanged) and a pre-shared key (`link-psk-v1`). The old links (`/r#<secret>`) have the same shape, but there's no backward compatibility: rooms live at most 24 hours.
- **Anyone inside can hand over the key, not only the creator (spec 2.2 says "the creator has to be online").** A deviation, made for availability: with only the creator, a closed laptop would lock everyone else out. For a link join the creator answers at once; other members answer after a random 1.2–2.5 s, unless an encrypted `door` notice says someone already took it. For a knock, any member can press "let in". The joiner takes the first offer and ignores the rest.
- **Per-handshake keys, not a per-room keypair (spec 2.2).** The host makes a fresh X25519 + ML-KEM-768 keypair for every join. Keygen takes milliseconds, and it means one leaked keypair exposes one handshake, not every join.
- **The shared secret.** `HKDF-SHA256(ikm = x25519_ss ‖ mlkem_ss, salt = SHA-256(transcript), info = "pq-hybrid-v1")`, as the spec says, with the transcript hash as the salt. The transcript is length-prefixed: version, mode, handshake id, host X25519 pk, host ML-KEM ek, joiner X25519 pk, ML-KEM ciphertext.
- **Link joins are authenticated with the psk.** The joiner sends `HMAC(HKDF(psk, th, "kx-link-joiner-v1"), th)`; the bundle key is `HKDF(shared ‖ psk, th, "kx-bundle-v1")`. So a relay without the link can neither get the key as a fake joiner nor hand out a fake key as a fake host. Code (words) joins have no psk: the words aren't secret from the relay.
- **What the bundle holds:** the raw room key, the link secret, the words, and the host's nickname (for the safety-word card). So everyone who's in can share the link and the words, and host joins.
- **The 4 words.** EFF short wordlist #1 (1296 words, CC BY 3.0 US), shipped as `web/src/crypto/wordlist.ts` (sha256 of the original file in its header). 1296⁴ ≈ 2⁴¹. The relay sees word *indices* (`w.12-345-6-1295`), because the list has one hyphenated word (`yo-yo`) and indices are plain HTTP tokens. Typed words may be separated by spaces, commas, dots or hyphens, in any case; `yo yo` is read back as `yo-yo`.
- **Where the words live at the relay.** A `Door` Durable Object per set of words (named `door-v1:<indices>`) stores `roomId` and `expiresAt`; its alarm deletes both at expiry. It's registered by the room object during the create, before the room exists; taken words make the create fail with the new error `taken`, and the client picks new words (3 tries). Melting a room early leaves its Door until the original expiry, pointing at a tombstone, so a knock gets "already melted". A small deviation from "the relay stores nothing but the expiry": the word → room mapping is needed to find the room, and the relay knows both anyway.
- **The lobby.** A knock connects with `melty.v1, w.<indices>` (no room id) and lands in the room's lobby: it receives only key-exchange frames addressed to it, can send only key-exchange frames (to the members), doesn't count as a person and gets no presence. At most 4 knockers per room; a knocker older than 3 minutes is closed (code 4008) when a new one comes; the client gives up after 2.5 minutes. Locking the room sends knockers away; when the last member leaves, knockers are told `not_found`. After the key arrives the joiner closes the lobby socket and connects as a member, by room id.
- **Knock limit per IP.** 10 per minute (burst 10), on top of the 60 connection attempts. Guessing 2⁴¹ words at that rate is hopeless per address, and a correct guess still needs a person to say yes.
- **Key-exchange frames on the wire.** `{t:"kx", to?, d}` from the client; the relay adds `from` (the sender's random 11-char socket tag, told to each socket in its hello) and delivers to `to`, or to every member. `d` is base64url JSON, at most 4096 chars (an ML-KEM offer is about 2.2k). They count against the same rate limits as messages; the client spends a token for each.
- **Safety words.** 6 words from the EFF short list, from the first 8 bytes of `SHA-256("melty-safety-v1" ‖ th)` (≈ 62 bits). Shown only for words joins, on both sides, with "same words" / "different". "Different" on the joiner's side leaves and wipes (error screen `mismatch`); on the host's side it posts a local warning suggesting to melt the room (creator) or leave (others). Link joins don't show them: the psk already rules out the relay.
- **Replay protection.** Every message's ciphertext starts with a clear 12-byte header: an 8-byte random sender id (new per tab) and a 32-bit counter. The header is in the AAD (`"melty-msg-v2" ‖ roomId ‖ header`). Receivers keep the highest counter per sender and drop anything not higher. The pre-sealed goodbye uses counter `0xFFFFFFFF`, so it's always accepted and always last. The IV stays random (not derived from the counter), so a sender-id collision can never reuse an IV.
- **Padding.** `[u16 length][plaintext][zeros]` up to 256, 1024 or 4352 bytes (the largest fits the 4096-byte plaintext limit). The relay accepts exactly the three resulting ciphertext lengths and refuses anything else with `bad`.
- **Messages before the key.** A link joiner is in the room's socket before it has the key; up to 64 encrypted messages are kept and opened once the key arrives.
- **"Nobody came."** A link joiner asks three times, 8 s apart; a knocker waits 2.5 minutes. Then the new error screen `nobody` keeps the link or words for "try again". A link joiner who finds the room empty (`n = 1` in its hello) gets that screen at once. A "not now" from inside gives the screen `turned_away`.
- **A create for an existing room is refused (`taken`)**, unless it carries the same owner hash (the creator retrying a create whose hello never arrived). Before, a create for an existing room quietly joined it. A create for a room id under a tombstone now says `taken` instead of `gone`.
- **Dependencies.** `@noble/curves` 2.4.0, `@noble/post-quantum` 0.7.1, `@noble/hashes` 2.4.0, exact versions. They're in the main bundle (about +75 KB): loading them lazily saved little once the landing page was fixed, and a lazily loaded chunk that failed while offline couldn't be retried in Chromium.

## Finishing round: PWA, OG image, Lighthouse, accessibility (2026-10-09)

- **PWA.** `web/public/manifest.webmanifest` and icons (192, 512, maskable 512) made from `favicon.svg`. The service worker is built from `web/sw.template.js` by a Vite plugin that fills in the list of built files and a version hash. It precaches `index.html`, the hashed JS/CSS/fonts, `favicon.svg`, `brand/hero.webp` and the manifest; pages are network-first with the cached shell as the offline fallback. It ignores anything that isn't a same-origin GET for those files or has a query string, so it never touches the relay, messages or room links. The CSP's `worker-src` went from `'none'` to `'self'`. Registered only in production builds.
- **OG image.** The existing generated art (`design-src/og-raw.png`) plus the cube and the wordmark in Quicksand, rendered by `scripts/brand-images.mjs` with the local browser. No new Higgsfield credits.
- **Lighthouse** (Lighthouse 12.8.2, headless Chromium 1194 in a container, against `vite preview`). Before this round the landing page scored 55 on mobile performance. The fixes:
  - `NeverAsk` measured every line's letters synchronously on mount (a forced full-page layout per line), and `FinalCta` interleaved layout reads and writes per letter. Now they measure from a ResizeObserver, read-then-write, and only when the section is near the screen; glyph scans are cached.
  - Everything below the hero renders in a `startTransition` right after the first paint.
  - Sections out of view pause their CSS animations; the long sections without pinned scrolling use `content-visibility: auto`.
  - On phones the frost canvas draws at 1× and every other frame, and starts 2.5 s after load.
  - `robots.txt` (it was answered by the SPA, which Lighthouse flagged).
  Results (best of a few runs; mobile varies by a few points between runs): home mobile 95–97 / desktop 100, how-it-works mobile 94 / desktop 100; accessibility, best practices and SEO 100 on both.
- **Accessibility.** axe-core 4.14 (WCAG 2.0/2.1/2.2 A and AA plus best practices) over home, how-it-works, the join dialog, the share sheet, the room, the knock screen, the knock prompt, the safety words and the mismatch screen, in dark and light: no violations after two fixes (an `sr-only` h1 in the room, and the message log is focusable so keyboards can scroll it). This is an automated check, not a screen-reader session with a person.
- **Lint debt.** All 18 warnings fixed and the `TODO(lint)` rules are errors again. Where the rule doesn't fit, a one-line disable says why (mount-only effects in `LiveMascot`, the message log's `[last?.id]` dependency, the bubble tap on phones that has a keyboard twin, the focusable log). Dialog backdrop clicks moved into `useSheet` as a native listener.
- **e2e in a container.** The browser scripts accept `BROWSER_PATH` (any Chromium binary) next to `BROWSER_CHANNEL`.

## Owner decisions (2026-10-09)

The owner approved these deviations from SPEC.md:
- **Room storage.** The relay stores the creator's owner hash and a lock flag in Durable Object storage, alongside `expiresAt`. Both are deleted at expiry.
- **Who can hand over the key.** Anyone inside the room can let a newcomer in, not only the creator.
- **Words mapping.** The 4-words → room id mapping is stored by the `Door` object until the room expires.

`SPEC.md`'s "only the expiry time in DO storage" rule should be read with these exceptions.

## Screenshot deterrents (2026-10-09)

The owner asked for screenshot protection. A website can't block or reliably detect screenshots: the operating system takes them. So melty offers **deterrents**, never called "protection". The creator switches them on per room.

**What they do:**
1. Messages stay blurred until you hover or focus them, or hold them on a touch screen. A long press is for reading and doesn't open the reaction picker.
2. The whole log and the composer blur when the window or tab loses focus: app switcher, a snipping tool taking focus, another window.
3. Your own nickname is drawn faintly across the log, so a leaked screenshot shows whose screen it came from.

**Also:** burn-after-read text always blurs when you look away, whether or not the deterrents are on.

**How it's built:**
- The setting is a creator-only control frame (`deter`), checked with the owner proof just like `lock`. Everyone is told about it, and newcomers get it in their hello.
- Unlike `lock`, it lives **only on the sockets, never in storage**. If the room ever empties, it's off again.
- The blur is visual only. The text stays in the DOM, so screen readers read it as usual.

**Not done:** detecting the PrintScreen key, because it's too unreliable to promise anything.
