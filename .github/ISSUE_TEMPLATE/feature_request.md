---
name: Feature request
about: Propose something new for melty
title: "feature: "
labels: enhancement
---

## The problem

<!-- What can't people do today, or what is awkward? Who is it for? -->

## The proposal

<!-- What would you build? Rough UI and behaviour are fine. -->

## Threat model impact

<!-- Required. See the threat model in the README. -->

- **What new data does the relay see?** (new frame types, sizes, timing, metadata)
- **Is anything stored, on the server or in the browser?** (Keys and messages may live only in memory.)
- **Does it change who can read, send or control a room?**
- **Does it add a limitation the threat model must mention?** (e.g. "a courtesy, not a guarantee")
- **Does it need anything the CSP doesn't allow?** (external requests, inline scripts, `data:` URIs)

## Hard rules check

- [ ] No claims beyond what will actually be built (no "post-quantum", "zk", "military grade", "100% anonymous", "unhackable", "anonymous").
- [ ] No logging of messages, IPs, roomIds or secrets.
- [ ] No analytics, tracking or third-party resources.
- [ ] No file uploads, no wallet or token functionality.
- [ ] Works with reduced motion, from 390px to 1440px, in dark and light.

## Alternatives considered

## Open questions / choices to record in ASSUMPTIONS.md
