# melty token utility: mechanisms and verdicts

*Role: utility designer. Sources: `README.md` (threat model), `ASSUMPTIONS.md`, RFC 9576-9578 (Privacy Pass), Session Network docs, Nym zk-nym docs.*

## Starting point

melty's value is what it **doesn't** know. Today the relay sees IPs, timing, room sizes and ciphertext. It stores only `expiresAt`, plus a 24 h tombstone and an in-memory, HMAC'd per-IP creation counter. Any token utility has to pass one test: **can anyone (relay, chain observer, Cloudflare, or the founder) link a wallet to a room, or learn more about who uses melty than they can today?** A public blockchain is a permanent, public log, which is the opposite of melty. So on-chain activity has to stay far away from room activity.

The founder's rule ("no wallet or token functionality in the app") is right. I'd sharpen it to: *the app never runs wallet code, never talks to a chain, and never sees a wallet address. At most, it accepts an opaque, unlinkable access pass.*

---

## 1. Paid "super rooms" via Privacy Pass vouchers

**How it works.**
- A separate companion site, the "melty pass issuer", sells fixed-denomination passes (for example "7-day room" or "32-person room").
- The client blinds a token request. The issuer signs it after payment, using publicly verifiable blind RSA (RFC 9578, token type 0x0002). The client unblinds it.
- Later, the melty app sends the pass with `?create=`. The relay checks it against the issuer's public key and records the token nonce in a spent-set to stop double spending.
- Because of the blind signature, the issuer can't link the pass it signed to the pass that gets redeemed.

**Privacy and threat model (strict).**
- The signature math is unlinkable. Deployments usually leak through what surrounds it:
  - **Anonymity set.** If 12 people buy passes in a month, unlinkability is weak. Use one key per epoch, few denominations, and no per-buyer keys.
  - **Key-tagging.** A malicious issuer can give each buyer a different key, which links redemptions back to buyers (RFC 9576 covers this as the key consistency problem). The fix is to publish the epoch key in one public, append-only place. **A chain is a good fit for that**, and it's one of the few places where a chain genuinely helps.
  - **Timing.** "Wallet bought at 14:02, a super room appeared at 14:03." Encourage buying in bulk ahead of time, and don't put the issuer on the same infrastructure or IP-visible path as the relay.
  - **On-chain purchases are public.** "This wallet is a melty customer" is itself a leak. Accepting payment rails other than the token (fiat, stablecoins) widens the anonymity set.
- The spent-set is **new server storage**. It must hold only token nonces: no `roomId`, no timestamps, deleted when the epoch key expires. That changes the "only expiry stored" claim, so it has to be documented in `ASSUMPTIONS.md`.
- Side benefit: passes are a privacy-friendly anti-abuse mechanism, which is what Privacy Pass was built for. Rooms created with a pass could skip the per-IP limiter.

**App rule.** It holds if the issuer and wallet live in a separate app on a separate origin, and melty only gets a "paste or scan pass" field. No chain code ships in the bundle, and `check:bundle` stays green.

**Demand.** It's real but niche: event organisers, journalists, incident-response teams, NGOs wanting a week-long room or more than 8 people. Bulk "gift" passes (an organisation buys 100 and hands them out) fit naturally. Honestly, **none of this needs a token**. It works the same with fiat or stablecoins.

**Effort:** M. **Verdict: build**, first with non-token payment. It's the strongest piece of the whole idea.

## 2. Burn-on-melt

**How it works.** Tokens paid for a super room are burned "when it melts".

**Privacy.** A literal per-room burn would need the relay or issuer to post an on-chain transaction at each room's melt time. That is a public per-room log of room count, lifetime and melt times, and it links back to the purchase. **That destroys the model.** The only safe version is burning at issuance, in batches (for example a weekly burn of all token revenue).

**Is it real value?** No. Economically it's a fee burn, the same as burn-on-purchase. "Burn on melt" is narrative layered on a supply mechanism, and calling it more than that would mislead buyers.

**App rule.** It's off-app (issuer treasury), so no conflict.

**Demand.** Users don't care. It only matters to holders.

**Effort:** S. **Verdict: maybe later, as a batched burn at issuance, described honestly as a fee burn.** Never per room.

## 3. Decentralised relay network (staked node operators)

**How it works.** Operators stake tokens and run open-source relays. Rooms map to nodes (for example by hashing `roomId`), and nodes earn fees from redeemed passes. Session (SESH on Arbitrum, May 2025) and Nym show this can work.

**Privacy and trust (strict).**
- Decentralising relays alone **makes metadata privacy worse**. Today one known party (Cloudflare and the founder, with no logs) sees IPs. With staked relays, unknown operators see IPs, room ids and timing, and staking doesn't stop them from logging.
- Slashing can't prove "didn't log" or "didn't record traffic". You can only slash what's observable, like uptime.
- The real gain comes only with an **onion or mixnet layer**, so no single node sees both the user's IP and the room. That's a different, much bigger product.
- melty's room model also centralises on purpose: one coordinator per room for limits, lock and expiry. Replicating it across untrusted nodes is hard. Lock and creator rights become consensus problems.

**Cheaper route to the same benefit.** Route melty's WebSocket traffic through **existing** infrastructure:
- Nym's mixnet with zk-nym credentials, which already sells anonymous, unlinkable access paid in NYM
- an OHTTP- or MASQUE-style proxy run by a separate party

Either gives real IP privacy without melty launching a network.

**App rule.** The client would need mixnet or proxy code, but no wallet. OK.

**Demand.** Operators stake for yield, so the demand is mostly speculative until there is real fee volume. At melty's scale, fees would be tiny.

**Effort:** XL. **Verdict: don't build our own. Maybe later: integrate an existing mixnet or proxy.**

## 4. Proof-of-usage metrics

**How it works.**
- In-memory aggregate counters: rooms created per tier per day, peak concurrent sockets, passes redeemed.
- Flushed once a day, rounded or bucketed (or with small differential-privacy noise), and published, optionally with a hash anchored on-chain.

**Privacy.** Fine if the data is daily, aggregate, never per room, and has no times finer than a day. It adds a small amount of storage, so document it.

**Credibility.** Self-reported counters prove little. What does prove something: **passes redeemed (relay counter) vs passes sold (on-chain or issuer log)** are two independent numbers that should reconcile. Anyone can check that the token's only use is actually happening.

**Effort:** S. **Verdict: build.** It's also useful without any token.

## 5. Governance

**What's governable:** pass prices and tiers, treasury spending (audits, bug bounties, relay costs), and later, network parameters.

**What's not governable, and should be hard-coded and stated publicly:**
- E2E encryption
- the no-logs rule
- what's stored
- the threat model
- that the app never touches wallets

Token voting is plutocratic, and "governance" sold as utility is mostly a figleaf.

**Effort:** M. **Verdict: don't, at launch.** Maybe later: a narrow treasury-grants vote.

## 6. Better ideas

- **Code transparency (strongest "this is real" signal).** The biggest gap in any web E2E app is that the server can serve malicious JavaScript to one user.
  - Make builds reproducible and publish release hashes to an append-only log, with an on-chain anchor.
  - Ship a small, separate verifier extension that checks the served bundle against the log.
  - This is a meaningful use of a chain, adds zero linkage, and needs no token.
  - **Effort:** M. **Verdict: build.**
- **Issuer-key transparency.** Publish Privacy Pass epoch keys on-chain, as described in section 1. **Effort:** S. **Verdict: build**, together with the passes.
- **Sponsored or gift passes.** Organisations buy pass batches for at-risk groups. The demand is real and it's privacy-neutral. **Verdict: build**, part of section 1.

---

## Summary table

| # | Mechanism | Privacy impact | "No wallet in app" | Real demand | Effort | Verdict |
|---|---|---|---|---|---|---|
| 1 | Super rooms via blind-signed passes | Neutral if done right; adds a nonce spent-set; anonymity-set and timing risks | OK (separate issuer app, opaque pass field) | Niche but real; token not required | M | **Build** (non-token payment first) |
| 2 | Burn-on-melt | Per-room burn: **severe leak**. Batched burn: neutral | OK (off-app) | None from users | S | **Maybe later**, batched, called a fee burn |
| 3 | Own staked relay network | Worse without a mixnet; XL with one | OK | Speculative | XL | **Don't**; maybe later use Nym or a proxy |
| 4 | Aggregate usage metrics | Neutral if daily and bucketed | OK | Credibility | S | **Build** |
| 5 | Token governance | Risk if it can touch security properties | OK (off-app) | Low | M | **Don't** (narrow grants later) |
| 6a | Code transparency (reproducible builds + log) | Improves security | OK (separate verifier) | High trust value | M | **Build** |
| 6b | Issuer-key transparency on-chain | Prevents key-tagging | OK | Required for #1 | S | **Build** with #1 |

---

## Recommended path

**Before any token exists** (credibility gates):

1. **Phase 2 shipped:** hybrid X25519 + ML-KEM-768 with safety codes. Also fix the known gaps in phase 1: replay protection and length padding.
2. **Independent audit published:** client crypto, relay, and the pass protocol. Plus a standing bug bounty.
3. **Open-source relay** that runs outside Cloudflare (self-hostable), and **reproducible builds with code transparency** (6a).
4. **Real usage:** several months of organic use, shown by published aggregate metrics (4).
5. **Paid passes proven with fiat or stablecoins.** If nobody pays for super rooms in euros, a token won't fix that.
6. **Regulatory homework:** an offer to the public in the EU falls under MiCA (a crypto-asset white paper, notified to the AFM in NL). Get advice. This is not legal advice.

**Minimal token design (only if you go ahead):**

- The token is **one more payment option** at the separate pass issuer. It is never required, never in the app, and never linked to a room.
- Fixed denominations, a single issuer key per monthly epoch published on-chain, and blind RSA passes (RFC 9578).
- Token payments are burned in weekly batches and described honestly as a fee burn.
- A published reconciliation of passes sold vs passes redeemed.
- Security properties are excluded from any governance, in writing.

**Honest conclusion.** Every piece of real utility here (unlinkable passes, code transparency, key transparency, verifiable metrics) **works without a token**. The token adds a payment rail, a burn narrative and a speculative layer. What would make crypto people say "this one is real" is building the privacy-preserving pass system and the transparency logs first, showing usage, and keeping the token optional and outside the product. If that leaves the token with too little purpose to justify it, the founder should take that as an answer too.
