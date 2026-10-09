# AUDIT: melty

The first audit was on 2026-10-08. This version shows the state after the fix round of 2026-10-09, updated after phase 2 and the finishing round (same day).

Each item gets a status: **klopt** (true), **klopt niet** (not true) or **weet niet** (unknown), with evidence. Where the status changed after the fix round, the earlier finding is given as "was: …".

**Checks for this version:**
- `pnpm check`: lint, typecheck, 88 web tests + 54 relay tests, build, bundle check and log check, all green. Lint has 0 errors and 0 warnings (see §6).
- All five browser tests against the production build (`vite preview` with a strict CSP), run back to back: `e2e-smoke`, `e2e-features`, `e2e-xss`, `e2e-resilience` and `e2e-phase2` are green (headless Chromium 1194 in a container).

---

## 0. Open items

| Item | Status | Evidence |
|---|---|---|
| Public link | **klopt** (redeploy needed) | The temporary deploy ran an older build; it gets redeployed after this round. |
| Branch merged, Node 22, pushed, CI green | **klopt** | `main`, `README.md:27`, CI run `37847461299` |

## 1. Claims must be true

| Item | Status | Evidence |
|---|---|---|
| CLAIMS.md with proof per claim | **klopt** (was: klopt niet) | `CLAIMS.md`: 18 claims, each with file and test |
| "Not independently audited" | **klopt** (was: klopt niet) | `README.md` (status line and threat model), `HowItWorks.tsx:158,212` |
| Burn-after-read described as best effort in the UI | **klopt** (was: klopt niet) | `RoomBubble.tsx:60`; `RoomComposer.tsx:73,77,130` |
| Claims that needed tightening | **klopt** (was: weet niet) | footer: "the relay keeps no logs" (`FinalCta.tsx:357`); "messages never stored on the server" (`Home.tsx:137`); "no chat history" (`Home.tsx:117`); "no messages stored" (`IceWorks.tsx:70,82`); "no relay logs" (`HowItWorks.tsx:137`) |

## 2. "Logs nothing", at platform level too

| Item | Status | Evidence |
|---|---|---|
| Observability/Logs off; no Logpush, no tail workers | **klopt** | `relay/wrangler.jsonc:7`, `relay/wrangler.share.jsonc`; `scripts/check-relay-logs.mjs` (in CI); ESLint `no-console` is an error for `relay/src` |
| What Cloudflare itself sees is in the threat model | **klopt** | `README.md` threat model: IP, timing, room id (in a header), sizes. `Report-To`/`NEL` on workers.dev is noted in the deploy notes in `ASSUMPTIONS.md`. |
| roomId not in the URL path or query | **klopt** (was: klopt niet) | Transport via `Sec-WebSocket-Protocol` on the fixed path `/ws` (`relay/src/offer.ts`, `index.ts`, `net/relay.ts`). Relay tests "creates and joins a room through the fixed path /ws…" and "refuses the old URL scheme and any query string". The roomId does still travel in a request header, which Cloudflare sees; this is documented. |
| Public usage figures not built | **klopt** | A proposal was made; not built, waiting for approval |

## 3. Key in the browser

| Item | Status | Evidence |
|---|---|---|
| Fragment read, kept in memory, removed from the address bar | **klopt** | `main.tsx` `takeFragment`; e2e-smoke "joiner's fragment is stripped" |
| Fragment also removed from browser history | **klopt niet**: can't be done; measured and documented | `scripts/history-check.mjs` in Edge 154 and Chrome 154: typed or clicked links leave `#key` in History, Favicons and Sessions. A website can't prevent this. Mitigation: the join dialog keeps the key out of the profile in both browsers (measured). Documented in `README.md`, `HowItWorks.tsx:109-111`, `CLAIMS.md` #14. |
| Clear message on reload | **klopt** | `Chat.tsx` (no-room screen) |
| Wipe on `pagehide` | **klopt** (was: klopt niet) | A pre-sealed leave frame goes out via `sendRaw`, then a synchronous wipe (`session.ts` `wipeNow`). Test `session.test.ts` "pagehide wipe … is synchronous". Delivery of the goodbye during a real bfcache freeze has not been measured. |
| Restore from bfcache | **klopt** | `main.tsx` `pageshow` handler: the store is emptied, then navigation to `/` |
| No secrets on the clipboard except "copy link" | **klopt** | The only `clipboard` call is `ShareSheet.tsx` (explicit button) |

## 4. Server-side enforcement

| Item | Status | Evidence |
|---|---|---|
| Max 8, lock, melt-now, message size, rate per connection | **klopt** | `relay/src/room.ts`, with relay tests using raw clients (see `CLAIMS.md` #10, #13) |
| Rate limit per IP | **klopt** (was: partly) | 60 connection attempts per minute and 20 new rooms per hour per IP, in memory under an HMAC (`limiter.ts` `admit`). Relay test for the per-IP limit. |
| Rate limit per roomId | **klopt** (was: klopt niet) | 20 messages per second per room, in memory (`room.ts`). Relay test for the per-room budget. |
| Client respects the budget (no silent message loss) | **klopt** (new) | Found during this round: typing notices used up the budget, and the relay silently dropped messages that the sender saw as sent. Fixed with a client-side token bucket that refuses up front (the draft is kept); typing notices never use the last tokens; and if the room budget still refuses, the bubble is marked "not delivered". Tests in `session.test.ts` ("client-side rate budget"). |

## 5. Robustness

| Item | Status | Evidence |
|---|---|---|
| Separate error screens | **klopt** (was: klopt niet) | `web/src/ui/RoomError.tsx` + `error.css`: not_found, expired, melted, full, locked, limit, slow, unreachable, lost. `e2e-resilience`. |
| Relay unreachable | **klopt** (was: klopt niet) | Its own screen with "try again". The key stays in memory only there, and it reconnects by itself when `online` fires (`e2e-resilience`). |
| Reconnect after a wifi switch, sleep or iOS background | **klopt** (was: klopt niet) | Backoff capped at 10 s with jitter, retried while the room is alive, immediate on `online`/`visibilitychange`, hard cap of 10 min (`resilience.ts`, `session.ts`). `e2e-resilience`: live again 0.1 s after 20 s offline, no double join notice. iOS Safari itself not measured (no WebKit available here). |
| Timer on server time, even with a skewed or jumping clock | **klopt** (was: partly) | Monotonic: `hello.now` plus `performance.now()` (`resilience.ts` `serverTime`, `session.serverNow`). Unit tests in `resilience.test.ts`. |
| Text, never HTML; XSS and odd unicode tested | **klopt** (was: klopt niet) | `scripts/e2e-xss.mjs` (8 payloads plus a hostile nickname). `<bdi>` isolation for message text and nicknames. |

## 6. Repo and dependencies

| Item | Status | Evidence |
|---|---|---|
| Versions pinned, lockfile committed | **klopt** (was: klopt niet) | All `package.json` files use exact versions; CI uses `--frozen-lockfile` |
| `pnpm audit` clean | **klopt** | "No known vulnerabilities found" |
| Dependabot on | **klopt** (was: klopt niet) | `.github/dependabot.yml` (npm + github-actions) |
| Secrets scan across the full history | **klopt** | gitleaks 8.30.1 run locally over all commits plus the working tree: no leaks. A gitleaks job is in CI. |
| CI: lint, typecheck, all tests, browser tests | **klopt** (was: partly) | `ci.yml`: lint, web and relay typecheck, tests, build, checks, gitleaks, e2e (smoke, features, xss, resilience) |
| Lint warnings | **klopt** (was: weet niet) | 0 errors, 0 warnings. The `TODO(lint)` block is gone and its rules are errors again; the few justified exceptions are one-line disables with the reason next to them (`ASSUMPTIONS.md`, finishing round). |
| docs/token internal, with a note in the README | **klopt** (was: klopt niet) | Note in `README.md` |

## 7. Phase 2

| Item | Status | Evidence |
|---|---|---|
| 4 words from the EFF short list, shipped locally | **klopt** | `web/src/crypto/wordlist.ts` (1296 words, sha256 of the source in the header), `words.ts`; tests "the list is the EFF short list…", "door codes roundtrip…" |
| Words only point to the room, limited per IP, expire with the room | **klopt** | `relay/src/door.ts`, `limiter.ts` (10 knocks/min), lobby in `room.ts`; relay tests "a create registers the words…", "limits knocks to 10…", "words expire with their room", "a knocker never sees room traffic…" |
| Hybrid handshake X25519 + ML-KEM-768, shared = HKDF(x ‖ m, "pq-hybrid-v1"), room key sent sealed | **klopt** | `web/src/crypto/kx.ts`; `kx.test.ts`; session tests; e2e-smoke and e2e-phase2 in real browsers |
| Both sides arrive at the same secret | **klopt** | `kx.test.ts` "both sides arrive at the same secret…" (code and link mode) |
| A man in the middle produces a different safety code | **klopt** | `kx.test.ts` "a man in the middle (code mode) ends up with a different safety code on each side" |
| Links via the same handshake, so links don't carry the key | **klopt** | `derive.ts` `deriveLink`; link joins authenticated with the psk (`kx.test.ts` link-mode MITM tests; session tests) |
| The creator has to be online | **klopt niet** (deliberately) | Any member can hand over the key; recorded as a deviation in `ASSUMPTIONS.md` |
| Safety code compared outside the app | **klopt** | `RoomDoor.tsx` `CheckCard` (6 words, "say them out loud…"); e2e-phase2 "both see the same 6 safety words" |
| Replay protection (counter in the AAD) | **klopt** | `crypto/frame.ts`, session test "drops a frame the relay plays a second time". Not covered: replays to someone who joined later (documented) |
| Padding to fixed block sizes | **klopt** | `frame.ts` `pad`, relay enforces the three sizes; e2e-phase2 checks every frame on the wire |
| "post-quantum" only after the tests pass | **klopt** | The claim appears only now, for the key exchange (`CLAIMS.md` #2) |

## 8. Finishing

| Item | Status | Evidence |
|---|---|---|
| PWA that never caches messages | **klopt** (was: klopt niet) | `web/sw.template.js` (same-origin GETs for build files only), manifest and icons; e2e-smoke "the service worker cached only static app files" |
| OG image with logo | **klopt** (was: klopt niet) | `web/public/brand/og.jpg`, made by `scripts/brand-images.mjs` |
| Lighthouse 90+ | **klopt** (was: weet niet) | Lighthouse 12.8.2, mobile and desktop presets, home and how-it-works: performance 94–100 (home mobile varies 95–97 between runs), accessibility, best practices and SEO 100. Measured in headless Chromium in a container, not on a real phone. |
| Accessibility audit | **klopt** for automated checks (was: weet niet) | axe-core 4.14, WCAG 2.2 AA + best practices, 9 screens × dark/light: no violations. A manual screen-reader session has **not** been done. |
| Mobile | **klopt** | As before; the new door screens were checked at 390px (e2e-phase2 screenshots) |
| Reduced motion stops heavy animations | **klopt** | As before; the new door screens switch their animations off under reduced motion (`door.css`) |
