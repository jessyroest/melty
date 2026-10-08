# melty: market and precedent research on privacy and messaging tokens

*Role: market and precedent researcher. Researched October 2026. Prices come from aggregators and move quickly. Treat them as orders of magnitude.*

## Bottom line

Among privacy and messaging projects, the tokens that people take seriously share one trait: **usage pays for something real, and that payment reaches the token in a way anyone can check on-chain.** Nodes stake to do work, and fees get burned or bought back. Every precedent whose token was "governance + vibes" lost more than 95% of its value, even when the product was good. Some of the most credible privacy products (Signal, Threema, and XMTP so far) have **no token at all**. Experienced investors know this. So the first question they ask melty will be: *"why does this need a token?"*

## Precedents

| Project | What the token does | Traction | Outcome / criticism |
|---|---|---|---|
| **Session (OXEN → SESH)** | Node operators stake 25,000 SESH to run the relay/storage network. Session Pro is bought in fiat, converted to SESH and burned, then re-minted into staking rewards | Claims >1M MAU; around 2,000 nodes migrated from Oxen | Migrated to its own network on 21 May 2025 with a 1 OXEN = 0.54 SESH conversion. Since then the token is down more than 90% from its high, and aggregators flag thin liquidity. Privacy Guides users criticise the conflict of interest of pushing their own coin, and the move from Monero-based OXEN to SESH on Ethereum/Arbitrum (a public chain) |
| **Nym (NYM)** | Staking for mixnodes and rewards for operators. NymVPN payments (fiat or crypto) feed a "perpetual buyback" of NYM, and users get unlinkable zk-nym credentials | NymVPN launched commercially in March 2025 | ATH $5.76 (Apr 2022), now about $0.02 (−99.7%). Critics say early investors dumped the token. The design is one of the best in the sector, but the token came years before the paying product |
| **Status (SNT)** | 2017 ICO for "governance, usernames, stickers…". Later meant to be staked on its own L2 | Raised about $100M in hours (June 2017) | Fell 92% in 2018. Its utility story was rewritten several times. In April 2026 it dropped its standalone L2 and folded into Linea, which weakened the SNT thesis again |
| **Signal + MobileCoin (MOB)** | In-app payments using a privacy coin | UK-only beta in 2021 | MOB peaked at about $73 on the announcement, then fell 99.8%. Users objected to Moxie's earlier ties to MobileCoin, the payment code staying closed for about 12 months, and a roughly 450% run-up before the announcement. Signal's own users saw it as "cashing in on blockchain" |
| **Secret Network (SCRT)** | L1 staking/gas for "private smart contracts" run on Intel SGX | Real DeFi ecosystem | In 2022, researchers at the University of Illinois (SGX.fail) extracted the network's **master decryption key**, which could expose every past private transaction. The lesson: the privacy claim itself is what gets audited |
| **Push Protocol (EPNS)** | Governance/staking for web3 notifications and chat | Integrations with dapps | Down more than 99% from its $8.77 ATH. Holders had little reason to keep the token |
| **XMTP** | **No token yet.** Fees are paid in **USDC** (about $5 per 100k messages). Future node staking is planned | $20M Series B at a $750M network valuation (2025). Mainnet planned for 2026 | Shows that per-message fees work fine without a token. XMTP warns publicly about fake "XMTP tokens" |
| **Telegram (TON/Gram)** | Pre-sold token for a new chain | Raised $1.7B (2018) | The SEC ruled it an unregistered securities offering. Telegram returned more than $1.2B to investors and paid an $18.5M penalty (2020) |
| **Threema** (no token) | — | Paid app (a few CHF one-time) plus Threema Work subscriptions, about 50 staff | Sustainable without ads, VC or a token. This is the counter-example: privacy users pay for privacy |
| **Helium (HNT)** (non-privacy, but a strong usage-tied model) | Burn-and-mint: Data Credits are bought by burning HNT, and since Aug 2025 Helium Mobile revenue buys and burns HNT | About $18–20M annualised revenue, 600k+ subscribers (end 2025) | Burns started to exceed emissions. It got there only after years of "empty network" criticism |
| **Brave (BAT)** (non-privacy) | Ad rewards/tips | 100M+ MAU for the browser | BAT down about 96%: "great product, dead token." Earn-and-dump means constant selling pressure |

## Patterns

**What worked (partly):**
- **Staking to do real work.** Node operators put up collateral to relay or store data (Session, Nym, Helium). Investors can check this: node counts and stake are on-chain.
- **Fiat in, token burned.** Users pay in a normal currency, and the protocol converts that to buys or burns behind the scenes (Session Pro, NymVPN, Helium Mobile). Users never have to touch crypto, and token demand grows with revenue. This is the most credible model right now.
- **Revenue anyone can verify.** Helium earned credibility only once its burn data showed real revenue (tens of thousands of dollars a day) instead of emissions.

**What failed:**
- **Token before product-market fit** (Status, Push, Nym's 2022 peak). Unlocks and emissions hit the market years before any fees existed.
- **Payment tokens nobody needs** (BAT, MOB). Users want to pay in dollars or stablecoins, so the token only adds friction and selling pressure.
- **Utility stories that keep changing** (SNT). Each pivot costs trust.

## Where the token HURT the privacy product

1. **Trust and conflicts of interest.** Signal's own community reacted badly to MobileCoin, and Privacy Guides members cite Session's coin as a conflict of interest. Privacy users read a token as a sign that someone wants to profit from them.
2. **Weaker privacy.** Session's move from OXEN (Monero-based) to a public-chain token means token activity is fully traceable. Secret Network shows that one hardware weakness can expose everything.
3. **Regulatory exposure.** Telegram/TON shows the SEC securities risk. Under MiCA (EU, relevant for a Dutch founder), any public offering of a utility token above €1M needs a crypto-asset white paper notified to the AFM, and the issuer is **liable** for misleading content. Separately, Session left Australia for Switzerland after police made an unannounced visit to an employee's home. Privacy projects attract scrutiny even without a token, and adding a token gives regulators a financial angle too.
4. **UX friction.** Wallets, gas and seed phrases clash with melty's core promise: "no account, just a link."
5. **Scams in your name.** XMTP has to keep warning users about fake tokens. Even announcing a token draws impersonators.

## What experienced crypto people actually check

1. **Does the token need to exist?** Remove it and see what breaks. If the honest answer is "nothing," the project is marked down as a cash grab.
2. **Usage metrics they can verify themselves.** MAU or rooms created from privacy-preserving counters, on-chain node counts, and burn/fee dashboards (Token Terminal, DefiLlama style). Claimed numbers they cannot check are ignored.
3. **Revenue → token link.** Real fees, ideally in fiat or stablecoin, converted into burns or buybacks on-chain. "Real yield" from revenue, not from inflation.
4. **Tokenomics.** Circulating supply vs FDV, insider and team allocation, vesting cliffs and unlock schedules. Binance Research warned about "low float, high FDV" launches with only 6–20% circulating, and around $155B in unlocks due over 2024–2030.
5. **Code and audits.** Open-source client and relay, reproducible builds, independent crypto audits (especially of HKDF/AES-GCM and the planned ML-KEM hybrid), and a bug bounty.
6. **Team.** Doxxed founders with a track record, a legal entity, and clear jurisdiction. Session's Swiss foundation is an example of the latter.
7. **Liquidity and holders.** Real depth vs a few wallets holding most of the supply, and whether the team controls the LP.
8. **Community quality.** Developers and real users vs farmers chasing an airdrop.

## Red flags (list only, do not do these)

- **Fake or wash volume:** Bitwise found that about 95% of reported BTC spot volume in 2019 was fake. Thin-liquidity tokens are watched for this.
- **Mercenary airdrops:** studies find up to 66% of airdropped tokens are sold right away, and 64% of 2025 airdrop recipients sold at TGE. Linea filtered out about 800k sybil wallets.
- **Paid shills posing as organic community,** and "partnership" announcements with insiders buying first (the run-up before MobileCoin's Signal announcement).
- **Vague "utility"** (governance, premium badges) with no fee flow behind it.
- **Closed-source "privacy"** or audit claims nobody can verify.
- **Low float plus large insider unlocks.**

## Implications for melty (for the team)

- melty currently has **no node network**: one Cloudflare Worker relays everything. That removes the strongest precedent (staking for real work) until relaying is actually decentralised. A token on top of one centralised Worker will be called out right away.
- The most defensible order is the one Threema/XMTP/Helium point to: **(1) real usage and fiat or stablecoin revenue first** (e.g., paid longer rooms, larger groups, team/business tier), **(2) publish verifiable metrics and audits**, **(3) only then add a token, if decentralising the relay gives it a real job**, with fiat converted to burns behind the scenes so users never see a wallet.
- Shipping the post-quantum hybrid with an independent audit would be a stronger "this is real" signal than any token mechanic.

## Sources

- Session: [launch plan](https://token.getsession.org/launch-plan), [migration](https://getsession.org/migrating-from-the-oxen-network-to-session-network), [SESH launch](https://token.getsession.org/blog/sesh-token-launch), [Pro beta / fiat→burn](https://token.getsession.org/blog/pro-beta-initial-features), [CyberInsider](https://cyberinsider.com/session-migrates-to-its-own-blockchain-network-for-better-control-and-security/), [Privacy Guides thread](https://discuss.privacyguides.net/t/thoughts-on-session-token/16778), [Privacy Guides removal debate](https://discuss.privacyguides.net/t/remove-session-from-instant-messaging/18852?page=2), [Delta liquidity note](https://delta.app/en/crypto/session-token), [404 Media on Australia exit](https://404media.co/encrypted-chat-app-session-leaves-australia-after-visit-from-police-2)
- Nym: [token flow](https://nym.com/blog/the-nym-token-flow), [The Block on zk-nyms/buyback](https://www.theblock.co/post/343452/nymvpn-launches-zero-knowledge-payment-and-perpetual-buyback-mechanism-for-public-testing), [CoinGecko](https://www.coingecko.com/en/coins/nym)
- Status: [Yellow SNT overview](https://yellow.com/asset/snt), [CoinCodex price history](https://coincodex.com/crypto/status/)
- Signal/MobileCoin: [Cointelegraph](https://cointelegraph.com/news/signal-under-fire-over-mobilecoin-partnership), [Decrypt](https://decrypt.co/55422/signal-is-experimenting-with-stellar-based-cryptocurrency-report), [CoinMarketCap MOB](https://coinmarketcap.com/currencies/mobilecoin/)
- Secret Network: [The Block](https://www.theblock.co/post/190914/secret-network-says-it-resolved-risk-from-intel-hardware-vulnerability), [Blockworks](https://blockworks.com/news/secret-network-crypto-transactions-not-so-secret-after-all), [sgx.fail](https://sgx.fail/)
- Push: [Mudrex](https://mudrex.com/learn/push-price-prediction-2024-2025-2030-and-beyond/)
- XMTP: [decentralization](https://xmtp.org/decentralization), [fees FAQ](https://community.xmtp.org/t/xmtp-fees-guiding-principles-and-faq/795), ["XMTP does not have a token"](https://improve.xmtp.org/t/xmtp-does-not-have-a-token/1110), [The Block Series B](https://www.theblock.co/post/363026/)
- Telegram/TON: [Shearman on SEC settlement](https://fintechperspectives.shearman.com/post/102grj3/telegram-settles-with-sec-agreeing-to-return-1-2-billion-to-investors-and-pay-p)
- Threema: [Why pay for Threema](https://threema.com/en/blog/why-pay-for-threema)
- Helium: [Tokenomics.com](https://tokenomics.com/articles/helium-tokenomics-how-hnt-distributes-100-of-network-fees-to-operators), [Blockworks](https://blockworks.com/news/helium-potential-path-deflationary-tokenomics)
- Brave/BAT: [Decentral Park Capital](https://decentralparkcapital.substack.com/p/braves-token-economics)
- Tokenomics/red flags: [Binance Research low float/high FDV (Cointelegraph)](https://cointelegraph.com/news/binance-urges-small-medium-projects-high-fdv-trend), [Forklog $155B unlocks](https://forklog.com/en/binance-highlights-155-billion-token-unlock-overhang/), [airdrop study (arXiv)](https://arxiv.org/abs/2312.02752), [ZK airdrop sells (Cointelegraph)](https://cointelegraph.com/news/top-zk-token-airdrop-recipients-sell-first-day-nansen), [Bitwise fake volume](https://www.technologyreview.com/the-download/613201/nearly-all-bitcoin-trades-are-fake-apparently)
- Regulation: [AFM white papers](https://www.afm.nl/en/sector/cryptopartijen/toezicht/white-papers), [Paul Hastings on MiCA white papers](https://www.paulhastings.com/insights/client-alerts/mica-crypto-white-papers-comply-or-be-de-listed)
