# Token research: summary

Research done on 2026-10-08 by three agents, covering market precedents, utility design, and risk/legal/trust. The full reports, with sources, are:

- [01-market.md](01-market.md): what privacy and messaging tokens did, and how they fared
- [02-utility.md](02-utility.md): token mechanisms that could fit melty, each with a verdict
- [03-risk.md](03-risk.md): MiCA and the AFM, privacy-specific risks, trust signals, a pre-launch checklist

> Not legal or financial advice. Talk to a lawyer with crypto experience before announcing anything.

## The short version

- **The app keeps its rule: no wallet or token functionality.** A wallet address linked to room usage would break melty's core promise.
- **Everything that adds real value works without a token.** That includes:
  - paid "super rooms" bought with anonymous, blind-signed passes (RFC 9578), so payment and usage can't be linked
  - verifiable aggregate usage numbers
  - reproducible builds
  - an audit
- **Precedents.** Good products with early tokens mostly ended up with near-worthless tokens (NYM, MOB, PUSH, SESH). The most trusted privacy products (Signal, Threema) have none. The first question will be: "why does this need a token?"
- **NL/EU.** A public token offer needs a legal entity (BV or stichting), even under the small-offer exemptions. Misleading white-paper statements create personal liability. Revenue share or buybacks can turn a token into a security.
- **Memecoin.** The worst fit for a privacy product.

## The credible order

1. A working product with real users. Phase 2 done, plus replay protection and padding.
2. Paid super rooms in euros through anonymous passes: proof that people pay.
3. A published audit, reproducible builds, public aggregate metrics, and an open-source relay that also runs outside Cloudflare.
4. Only then, if at all: a token as one optional payment method at a separate pass issuer. It must never be required and never be linked to a room. A weekly fee burn would be honestly labelled as a fee burn.

## Never say

"anonymous", "unhackable", "quantum-safe" (until phase 2 ships), "MiCA-compliant", guaranteed returns, or listing teasers.
