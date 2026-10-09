# SPEC: melty

The owner's specification. Original name: "PROJECTNAAM". The owner named the project "melty" on 2026-10-08. Translated from the Dutch original. Later rounds of instructions are summarised at the end.

## Goal

A web app where anyone, without an account, opens a chat room and shares it by link, QR code or 4 words. The room disappears completely when its timer runs out. The server only sees encrypted data and stores no messages.

## Way of working

- Work phase by phase. Start each phase with a short plan (files, data flows, message formats) and wait for approval before writing code.
- Stop after each phase, show what's there, and explain how to test it locally.
- Ask before deviating from this spec. Record every self-made choice in ASSUMPTIONS.md.

## Hard rules

- **Claims.** No claim in the UI, README, metadata or copy that isn't demonstrably in the code. No "zk", "military grade", "100% anonymous" or "unhackable". "post-quantum" only after phase 2 is done and tested; until then only "end-to-end encrypted".
- **Server.** The server never stores message content and never logs messages, IP addresses, roomIds or secrets.
- **Keys.** Keys only in memory. Never in localStorage, sessionStorage, IndexedDB, cookies or the URL query.
- **No third parties.** No analytics, no tracking, no third-party scripts, fonts or images from CDNs. Everything self-hosted.
- **Security headers.**
  - A strict CSP: no inline scripts, no external origins except our own relay.
  - `Referrer-Policy: no-referrer`
  - `X-Content-Type-Options: nosniff`
  - a Permissions-Policy that turns off camera, microphone and geolocation
- **No console.log** of plaintext, keys or fragments, not even in dev.
- **Scope.** No file uploads. No wallet or token functionality.
- **Originality.** Don't copy names, mascots, slogans or copy from existing products.

## Stack

- **Repo:** monorepo with `/web` and `/relay`, pnpm workspaces.
- **`/web`:** Vite + React + TypeScript. UI language English.
- **`/relay`:** Cloudflare Worker + Durable Objects, one DO per room, WebSocket Hibernation API.
- **Crypto:** WebCrypto (HKDF-SHA256, AES-256-GCM). Phase 2 adds `@noble/curves` (x25519), `@noble/post-quantum` (ml_kem768) and `@noble/hashes`.
- **QR:** the `qrcode` package, generated client-side.
- **Tests:** vitest for web and crypto, and the workers test environment for the relay.

## Theme

**"Melting."** Every room is an ice cube that melts as the timer runs down, then evaporates when it expires.

- **Mascot:** a small, friendly ice cube with its own design.
  - The melt is done in SVG/CSS and linked to the real timer.
  - Colours are design tokens. Dark is the default (deep night blue, ice cyan, frosted glass); light is ice white with night-blue text. `prefers-color-scheme` is respected.
  - One self-hosted rounded geometric sans font.
- **Micro-interactions:**
  - burn-after-read messages drip away
  - a condensation effect on panels
  - `prefers-reduced-motion` is respected
- **Copy and accessibility:**
  - Short, dry copy; lowercase is fine.
  - Mobile first and accessible: contrast, focus states, labels, and screen-reader text for the timer.

## Phase 1: MVP

1. A random 32-byte secret in the URL fragment: `/r#<secret>`.
2. Key derivation:
   - `roomId = HKDF(secret, "room-id-v1")`
   - `roomKey = HKDF(secret, "room-key-v1")`, an AES-256-GCM key, non-extractable
3. Messages are `{nick, text, ts}`, encrypted with AES-256-GCM, a random 12-byte IV and AAD = roomId. Only `{iv, ciphertext}` goes to the relay. System messages are encrypted too.
4. The relay forwards ciphertext and stores nothing except the expiry time.
5. **Timer:** 10 min, 1 hour or 24 hours, set as a DO alarm.
   - At expiry the relay closes all sockets, wipes all state, and refuses the roomId for a margin.
   - The client shows the time left based on server time.
6. **Client wipe:** on expiry, leave or tab close, wipe messages and keys and go back to the start screen.
7. **Sharing:** copy the link, a QR code of the full link, and a warning that anyone with the link can read along.
8. **Nicknames:** random per session, editable, never stored.
9. **Limits:**
   - max 8 people
   - 4 KB per message
   - a rate limit per connection
   - a limit on new rooms per IP per hour
   - IP addresses are counted only in memory
10. **UI:** a start screen, a chat screen with the melting mascot as timer, share buttons, and an honest "how it works" page.

## Phase 2: 4-word codes and a hybrid post-quantum key exchange

1. **4 words** from the EFF short wordlist (shipped locally). They only point to the room at the relay and are not a key. The relay limits attempts per IP, and codes expire with the room.
2. **Handshake.**
   - The creator has a hybrid keypair per room: X25519 + ML-KEM-768.
   - A joiner does X25519 ECDH plus ML-KEM encapsulation.
   - Shared secret = `HKDF(x25519_ss || mlkem_ss, "pq-hybrid-v1")`. The creator sends the roomKey encrypted with it.
   - The creator has to be online for this.
3. Optionally, the same handshake can be used for links, so links don't carry the key themselves.
4. **Verification:** a short safety code (6 words or emoji) from a hash of the full handshake transcript, compared outside the app.
5. Only after phase 2 tests pass may "post-quantum" appear in the UI and README.

## Phase 3: extras

- Burn-after-read per message.
- A typing indicator, encrypted.
- The creator can melt the room early.

## Tests

- **Crypto:** a roundtrip works. A wrong key fails, and so does tampered ciphertext, IV or AAD.
- **HKDF:** it is deterministic, and the roomId doesn't leak the secret.
- **Relay:**
  - it forwards messages and stores none
  - the room is gone after expiry and refuses new connections
  - all limits work
- **Phase 2:** both sides arrive at the same secret, and a man-in-the-middle produces a different safety code.
- **No secrets in logs:** relay logs never contain plaintext, secrets, fragments or IP addresses.
- **No external URLs:** a script checks that the built bundle loads none.

## Deliverables

- `pnpm dev` runs everything locally.
- A README covering local use, deployment and the threat model.
- `ASSUMPTIONS.md`.
- A list of the Higgsfield credits and prompts used.

---

## Later rounds (summary)

- **Phase 3 done**, plus extras:
  - room lock
  - reactions
  - an encrypted typing indicator
- **Frontend redesign.**
- **"Lock it down" round (2026-10-08)**, in this order:
  1. finish the open items
  2. a quality and security round, following AUDIT.md: claims backed by CLAIMS.md, no logs at platform level, the key in the browser, server-side enforcement, robustness, repo and dependencies, plus top mobile quality
  3. phase 2, plus replay protection (a per-sender counter in the AAD) and padding to fixed block sizes
  4. finishing: a PWA that never caches messages, an OG image with the logo, Lighthouse 90+, an accessibility audit

  The pass-shop is deferred until the owner says so. No token work.
- **Phase 2 and the finishing round (2026-10-09).** The owner asked to finish the project. Done: the 4 words, the hybrid X25519 + ML-KEM-768 key exchange (also for links, so links no longer carry the key), safety words, replay protection and padding, then the PWA, the OG image with the logo, Lighthouse 90+ and an automated accessibility audit. Deviations are in ASSUMPTIONS.md (anyone inside can hand over the key, not only the creator; the relay stores which room the words point to until expiry).
