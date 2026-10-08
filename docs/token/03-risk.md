# melty token: risk, legal and trust brief

*Research current to 8 October 2026. **This is not legal or tax advice. Consult a Dutch crypto/financial-regulation lawyer and a tax adviser before you announce, mint or sell anything.** Items marked (uncertain) are my reading of the rules, and a lawyer should confirm them.*

---

## 1. EU / Dutch regulation

### MiCA: the default rule for a token like this
A melty token would most likely be an "other crypto-asset" under **MiCA Title II**. It would not be a stablecoin (ART/EMT). To make a **public offer** in the EU, the offeror must ([Art. 4 MiCA](https://www.springlex.eu/en/packages/mica/mica-regulation/article-4/)):
- **be a legal person.** A private individual cannot be the offeror.
- write a crypto-asset white paper (Art. 6), **notify it to the AFM at least 20 working days before publication** (Art. 8) and publish it (Art. 9). [AFM white papers page](https://www.afm.nl/en/sector/cryptopartijen/toezicht/white-papers); send it to whitepapers.submission@afm.nl.
- keep marketing communications fair, clear, not misleading and consistent with the white paper (Art. 7), and act honestly and professionally (Art. 14).

The **AFM does not approve** Title II white papers. It only receives the notification. The AFM says that calling a document a "MiCAR-compliant white paper" is **incorrect and misleading** ([AFM](https://www.afm.nl/en/sector/cryptopartijen/toezicht/white-papers)). Since **23 Dec 2025**, white papers must be filed in **Inline XBRL with an LEI**. PDF-only filings no longer meet the rules ([ESMA statement](https://www.esma.europa.eu/sites/default/files/2025-11/ESMA75-1303207761-6284_Statement_to_support_the_smooth_implementation_of_MiCA_standards_and_format.pdf)).

### Exemptions, and where they stop
- **Small offers (Art. 4(2)):** this covers offers to fewer than 150 persons per member state, offers under **€1M in 12 months**, and offers to qualified investors only. The white-paper and notification duties fall away. **The legal-person requirement, the marketing rules and the Art. 14 conduct duties still apply** ([verbatim: "points (b), (c), (d) and (f) shall not apply"](https://www.springlex.eu/en/packages/mica/mica-regulation/article-4/)). If total consideration exceeds €1M a year, you must notify the AFM why the offer is exempt ([summary](https://legalbison.com/en-kr/blog/mica-white-paper-requirements/)).
- **Whole-title exemptions (Art. 4(3)):** these cover tokens **offered for free**, but an offer is not "free" if people have to hand over personal data or pay indirectly. They also cover tokens giving access to a **good or service that already exists or is in operation**, mining rewards and limited networks.
- **The catch:** all of these exemptions are **lost as soon as you or anyone acting for you communicates an intention to seek admission to trading**. That includes saying "we'll list on an exchange". A utility token for a service that does not exist yet can only be offered for up to 12 months (Art. 4(6)).
- (uncertain) MiCA's "admission to trading" means a trading platform run by an **EU** CASP. A Solana DEX or pump.fun listing may not count, but regulators can still treat the creator as an offeror. Legal opinion on this is unsettled.

### Liability
**Art. 15:** if the white paper is incomplete, unfair, unclear or misleading, the offeror **and the members of its management body personally** are liable to holders for their losses. Any contract clause that limits this liability is void ([ESMA rulebook](https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-15-liability-information-given)). **Title VI market-abuse rules** (insider dealing, manipulation, pump-and-dump, wash trading) apply to *any person* once a token is admitted to or requested for trading, even when the trades happen on a DEX ([Cambridge EJRR](https://www.cambridge.org/core/journals/european-journal-of-risk-regulation/article/cryptoasset-market-abuse-under-eu-mica/FDC11EC096728B9EF1097A5346F0EF27)).

### AFM stance
The AFM has repeatedly warned that the crypto market is "fragile" and shows bubble characteristics, and it singles out **memecoin hype** ([HomeFinance](https://www.homefinance.nl/nieuws-blog/2025/afm-slaat-alarm-cryptomarkt-oververhit-barst-de-bubbel-bijna/)). It has also warned about **finfluencers** who do not disclose paid interests ([Banken.nl](https://www.banken.nl/nieuws/23534/afm-waarschuwt-voor-onbetrouwbare-finfluencers)). Expect the AFM to read your marketing closely.

### When the token becomes a security (MiFID II)
MiCA does **not** apply to crypto-assets that qualify as financial instruments. ESMA's [guidelines under Art. 2(5)](https://www.regulationtomorrow.com/2025/03/official-translations-guidelines-on-the-conditions-and-criteria-for-the-qualification-of-crypto-assets-as-financial-instruments-under-mica/) (applying from 2025; see [BDO summary](https://bdo.com.mt/en-gb/news/news-in-2025/understanding-the-esma-guidelines-on-crypto-assets-as-financial-instruments)) look at substance over form. A token moves toward being a **transferable security** if it gives:
- a **share of revenue or profit**, dividends or interest
- **buybacks or burns funded by revenue** and marketed as price support
- staking yield paid from company income
- governance rights over a company that come with economic rights

If it is a security, you need a prospectus or an exemption, and possibly a licence. That is a much heavier regime. **Rule: no economic rights and no profit promises, ever.**

### Individual vs. company, and tax at a high level
- **As an individual** you cannot make a non-exempt public offer under MiCA, and even exempt small offers require a legal person. You would also carry the full liability personally.
- **A BV** is the standard vehicle. It limits liability, but Art. 15 still reaches the directors. It pays corporate income tax (vennootschapsbelasting).
- **A stichting (foundation)** is a common choice for "neutral" token stewards. It can still owe Vpb if it runs an enterprise (uncertain, so get advice).
- **Tax for you as an individual issuer:** income from creating and selling your own token is most likely taxed in **box 1** (business profit or "resultaat uit overige werkzaamheden") rather than box 3 (uncertain). Ordinary holdings sit in box 3. Box 3 moves to taxing actual returns, including unrealised gains, from 2028 ([crypto.news](https://crypto.news/bitcoin-holders-in-netherlands-could-face-tax-on-unrealized-gains-from-2028/); [Jongbloed](https://www.jongbloed-fiscaaljuristen.nl/databank/inkomstenbelasting/box_1/crypto_trading_en_belastingheffing/)). **DAC8** exchange reporting to the Belastingdienst has applied since 1 Jan 2026 ([Grant Thornton](https://www.grantthornton.nl/insights/tax/box-3/crypto-in-box-3-actuele-regels-en-aandachtspunten/)).

---

## 2. Risks specific to a privacy app with a token

**The precedents:**
- **Tornado Cash.** US sanctions were overturned in *Van Loon* (5th Cir., Nov 2024), which held that immutable smart contracts are not "property". OFAC delisted it in March 2025 ([Paul Hastings](https://www.paulhastings.com/insights/crypto-policy-tracker/a-whirlwind-of-change-the-delisting-of-tornado-cash)). Developer **Roman Storm** was nonetheless **convicted on the unlicensed money-transmitting count** (Aug 2025). His **retrial on laundering and sanctions charges has been pushed to April 2027** while an acquittal motion is pending ([The Block](https://theblock.co/news/regulation/2026-08-26-tornado-cash-roman-storm-retrial-april-2027-412761)).
- **Alexey Pertsev**, who lives in NL, received **64 months** from the Den Bosch court in 2024. His appeal is pending and he was released under electronic monitoring ([The Block](https://www.theblock.co/post/339401/tornado-cash-developer-alexey-pertsev-gets-nod-for-conditional-release-from-prison-to-work-on-appeal)). I could not find an appeal ruling as of Oct 2026 (uncertain).
- **Samourai Wallet:** Rodriguez got **5 years** and Hill **4 years** after guilty pleas to unlicensed money transmission. Prosecutors cited **active promotion to darknet criminals** and internal remarks that the product was "money laundering for Bitcoin" ([Decrypt](https://decrypt.co/347601/developer-bitcoin-app-samourai-sentenced-5-years-prison)).

**Why melty is different, and how to keep it that way.** Those tools **moved and obscured money**, and they handled more than $1B in criminal funds. A chat relay moves **messages**, not value. The danger comes from adding a token: in-app tipping, paying for rooms anonymously, or "private transfers" would pull melty toward money-transmission and AML territory. The EU **AMLR (from 10 July 2027)** bars CASPs from handling anonymity-enhancing coins and anonymous accounts ([Cointelegraph](https://cointelegraph.com/news/eu-crypto-ban-anonymous-privacy-tokens-2027)). A token marketed as "private money" would be hard to list in the EU and would attract attention you do not want. **Keep the token far away from value transfer between users.** The Samourai case also shows that **how you market** is evidence in court.

**Reputational risk.** A tradable token draws speculators, and on a privacy product it also draws people looking for laundering or scam infrastructure. Bruce Schneier's critique of Signal adding MobileCoin applies directly: crypto "muddies the morality of the product, and invites all sorts of government investigative and regulatory meddling" ([Schneier](https://www.schneier.com/?p=62132); [Cointelegraph](https://cointelegraph.com/news/signal-under-fire-over-mobilecoin-partnership)).

**The token can undermine the product's honest claims.** melty's appeal is "no account, the server sees only ciphertext". A token can quietly break that:
- **Wallet addresses are persistent public identifiers.** Linking a wallet to room usage creates exactly the metadata trail melty promises not to keep.
- **Price talk will drown out security talk.**
- **The token holder becomes a constituency** that can pressure product decisions.

Design the token so that **using melty never requires a wallet**.

---

## 3. What crypto-native people check, and the red flags that make them leave

| They check | Trustworthy signal | Red flag |
|---|---|---|
| Team | Named (doxxed) founder, real LinkedIn/GitHub history, an EU legal entity | Anonymous team plus a large insider allocation |
| Code | Open source, **reproducible builds**, signed releases, a public threat model | Closed relay, "trust us" crypto |
| Audits | A **published** report with findings and fixes, from a recognised firm. For E2E messengers: Cure53, NCC Group, Trail of Bits, Least Authority (my assessment) | "Audited" with no report, or an unknown firm paid in tokens |
| Tokenomics | Full allocation table, team share small and **vesting with a cliff**, an on-chain vesting contract, a public unlock schedule | Concentrated holders, hidden wallets, sudden unlocks |
| Contract | **Mint and freeze authority revoked** (Solana) or renounced; no adjustable tax | Live mint authority, high or changeable sell tax, blacklist functions |
| Liquidity | LP tokens **burned or time-locked** with a verifiable lock, and the expiry date stated | Unlocked or short locks, extra insider-controlled pools |
| Marketing | Honest docs, a risks section, disclosed partnerships | Paid KOL shilling, "100x", countdown hype |
| Traction | **Real users before the token** (public usage metrics) | The token comes before the product |

**How scams get detected** ([Trust Wallet](https://trustwallet.com/blog/Academy/how-to-spot-a-rug-pull)):
- **Rug pulls:** insiders drain or unlock liquidity. Detected through LP-lock checks and holder-concentration analysis on Solscan or Etherscan.
- **Honeypots:** the contract blocks or heavily taxes selling. Detected by sell simulation (Honeypot.is, GoPlus, Token Sniffer, rugcheck.xyz).
- **Fake volume:** wash trading between linked wallets. Detected through wallet-cluster analysis (Bubblemaps-style).

**Do the opposite, and make every item checkable on-chain.** Context: Solidus Labs found that about **98.7% of pump.fun tokens** showed pump-and-dump or rug-pull traits ([Solidus Labs](https://www.soliduslabs.com/reports/solana-rug-pulls-pump-dumps-crypto-compliance)). The default assumption about any new Solana token is "scam".

---

## 4. Memecoin vs. utility token: a candid comparison

| | Memecoin (pump.fun-style) | Utility token (structured) |
|---|---|---|
| Regulation | Still an "other crypto-asset" under MiCA; there is no memecoin exemption. As an individual creator you have no legal-person wrapper, the position is murky (uncertain), and market-abuse rules apply. | A planned path: BV or foundation, an exemption analysis or a notified white paper, controlled marketing. |
| Credibility for a privacy product | **Very damaging.** It signals "cash grab" to the security audience melty needs, and the base rate is about 98% rugs. | Neutral to positive, but only if the utility is real and the product works without the token. |
| Long-term outcome | Typical pattern: a spike, then a dump to near zero. The founder's name stays attached to the chart forever. | A slower, smaller, often illiquid outcome. It survives only if the utility does. |

Being candid: a memecoin is the fastest launch and the worst fit for a privacy product. The founder's earlier memecoin concept site would be found and used to frame melty. If you go ahead, **keep the two brands strictly separate** and say openly that they are separate. The most credible option is **no token yet**: ship melty, get users, publish audits, and decide later.

---

## 5. Pre-launch checklist (in order)

1. **Product first.** Run melty publicly with real users and publish anonymous aggregate usage stats.
2. **Security proof.** Open-source the client and relay, publish a threat model, set up reproducible builds, get an independent audit published, and run a bug-bounty or disclosure policy.
3. **Legal opinion** from a Dutch MiCA lawyer covering: token classification (MiCA vs. MiFID II), which exemption applies (if any), the white-paper need and the AML angle. **Get it in writing.**
4. **Entity.** Set up a BV or stichting, get an LEI, open a business bank account, and get tax advice (box 1 / Vpb / VAT).
5. **Token design review:**
   - no revenue share, buyback promises or yield
   - no value transfer between users
   - melty usable without a wallet
6. **Documents:**
   - the white paper in iXBRL, notified to the AFM 20 working days before publication if required
   - a plain-language risks page
   - a full tokenomics table and on-chain vesting schedule
7. **Contract hygiene:** revoke mint and freeze authority, audit the token or vesting contracts, lock or burn LP and publish proof.
8. **Insider policy:** a written rule that the team does not trade around announcements (MiCA Title VI) and that all team wallets are disclosed.
9. **Marketing review.** Every post is checked against the white paper, and paid promotions are disclosed. No KOL deals.
10. **Only then announce,** and do not mention any exchange listing until the legal analysis covers it.

**Never say:**
- "guaranteed returns", "price will go up", "100x", "passive income", "investment opportunity"
- "**anonymous**". Say "no account required; the server sees only ciphertext". IP addresses and metadata still exist.
- "**unhackable**", "100% secure", "military-grade"
- "**quantum-safe**" or "post-quantum", until that is actually built and audited
- "AFM-approved" or "MiCA-compliant/certified"
- "untraceable" or "perfect for private payments", which echoes Samourai-style marketing
- "listing on [exchange] soon", which can void your exemptions

*Again: not legal advice; consult a lawyer.*
