## Summary

<!-- What does this PR change, and why? Link the issue if there is one. -->

## How it was tested

<!-- Commands you ran and what you checked by hand. Delete what doesn't apply. -->

- [ ] `pnpm check` (test + build + check:bundle + check:logs)
- [ ] `pnpm e2e` and `pnpm e2e:features` against the relay + `web preview`
- [ ] Manually in the production-like setup (`pnpm build`, relay dev, `web preview` on :4173)
- Browser(s) used:

## Hard rules

See [CONTRIBUTING.md](../CONTRIBUTING.md#hard-rules). Tick each one, or explain below why it doesn't apply.

- [ ] **Claims:** nothing in the UI, README or metadata claims more than the code does. No "post-quantum", "zk", "military grade", "100% anonymous", "unhackable" or "anonymous".
- [ ] **No logs:** no `console.*` in the relay; nothing logs messages, IPs, roomIds, secrets, keys or fragments.
- [ ] **No storage of keys:** keys, secrets and messages stay in memory only (no localStorage, sessionStorage, IndexedDB, cookies or URL query). The server stores no message content.
- [ ] **CSP-safe:** no inline scripts or styles, no `dangerouslySetInnerHTML` / `innerHTML`, no `data:` URIs, no third-party scripts, fonts, images or analytics.
- [ ] **Reduced motion:** new animations and transitions switch off under `prefers-reduced-motion`.
- [ ] **Mobile and desktop:** checked at 390px and at 1440px wide.
- [ ] **Dark and light:** checked in both themes.
- [ ] **Accessible:** keyboard reachable, labelled, visible focus.
- [ ] **No uploads, no wallet or token features, nothing copied from other products.**
- [ ] **ASSUMPTIONS.md** updated if I made a choice the spec or issue didn't pin down.
- [ ] **Threat model** in the README updated if this changes what the relay can see or what the app protects against.

## Notes for the reviewer

<!-- Anything you're unsure about, follow-ups, screenshots (strip room links first). -->
