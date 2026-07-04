# 402 / AI Content-Gating Probe -- Top Content Providers

Dataset behind Shoal Research's essay **The Internet is Breaking**. It answers one
question empirically: when an AI agent shows up at a major content provider, what
happens, who is managing the gate, can the agent actually pay to get in, and does
the publisher already have an AI licensing deal in place.

## What is here

- `data/publisher_gating_probe.csv` (and `.json`) -- 108 content-provider domains,
  each probed with the GPTBot user agent. Columns: domain, gating manager, gating
  vendor, HTTP status, response type, whether it is licensable, whether Cloudflare
  fronts it, the observed challenge, the result of a real TollBit API token test
  (for TollBit-managed sites), and the publisher's public AI-licensing status and
  counterparties.
- `data/x402_open_rail_census_2026-06-30.json` -- the full Coinbase x402 discovery
  registry pulled on June 30 2026 and cross-checked against on-chain settlement on
  Base (22,469 payable endpoints across 1,154 domains).

## How the domains were selected

The list is built from two overlapping frames.

1. **Traffic.** The highest-traffic content-provider websites by SimilarWeb's
   category rankings (News & Media, Arts & Entertainment, Reference, Finance;
   May 2026 data), cross-checked against Press Gazette's ranking of the biggest news
   websites in the world (2026). This is what anchors the sample to the sites AI most
   wants to read.
2. **Licensing relevance.** The publishers named in the major AI-content-licensing
   deals and lawsuits, and the sites listed on the leading AI-licensing marketplace
   (TollBit). This is what makes the sample the plausible universe for gating and
   pricing content to machines.

**Content providers only.** Search engines and portals (Google, Bing, Yahoo, MSN,
Yandex, Baidu, Naver, DuckDuckGo), social networks, e-commerce, and streaming are
excluded. Reddit, Wikipedia, Substack, Medium, Stack Overflow, and WordPress are
included because they are content platforms, not search or commerce.

**Honest caveats on curation.** The sample is deliberately weighted toward
English-language publishers, and it includes a set of high-authority editorial
outlets (The Information, 404 Media, Semafor, ProPublica, Nature, Harvard Business
Review, and the entertainment and technology trades) whose influence exceeds their
raw traffic. It is therefore not a strict traffic ranking. The largest content
providers it does not cover are non-English or portal-family properties outside the
probe's licensing ecosystem, including Yahoo News Japan, globo.com (Brazil),
namu.wiki (South Korea), MSN, and Yahoo Finance.

## Method

Each domain was requested with the GPTBot user agent and the raw HTTP status and
body were recorded. Sites listed on TollBit were then tested with a valid TollBit
developer key and a registered agent, requesting content through the TollBit
gateway. The open-rail census was built by paginating the Coinbase x402 discovery
API in full and confirming settlement on Base. The AI-licensing status of each
publisher was compiled from the AI companies' own announcements, Press Gazette's
deal tracker, and the filed complaints, and is current to mid-2026.

## Headline finding

Of 108 content providers probed, **not one could be paid on demand**. The 10 sites
that answered with an HTTP 402 were all dead ends: 8 route through TollBit (7 return
"rate not found for license type" and BBC Good Food requires a token on its own
`tollbit.` gateway), one (Slate) is a manual email gate, and one (Fandom) returns a
402 that reads "please contact the site owner for access." Every one is a whitelist
or manual-approval gate. Roughly 35 blocked the AI crawler outright and 55 served
content for free. **Zero exposed an open, payable x402 rate.**

### Response breakdown

| Response | Count |
| --- | --- |
| Serves free | 55 |
| Blocks AI crawler | 35 |
| Returned 402, none payable | 10 |
| Error/timeout | 3 |
| Auth required | 2 |
| Not acceptable | 2 |
| Legal/geo block | 1 |

Note: "Returned 402" counts sites that answered with an HTTP 402 status, not sites
that could actually be paid. Every 402 in this set is gated behind TollBit approval,
a manual license, or a "contact the owner" wall. Per-site payability is in the
`TollBit Test Result` column.

## AI licensing status

Every publisher is annotated with its public AI-licensing posture: whether it has
**licensed** content to an AI company, is **suing** one, is **both** (licensed to
one AI company while suing another), or has **no public deal or suit** found.

| Status | Count |
| --- | --- |
| Licensed | 25 |
| Suing | 16 |
| Both (licensed and suing) | 25 |
| None found | 42 |

The licensing posture explains the probe. Publishers that have licensed their
content overwhelmingly **block the open crawler (HTTP 403)**, because they route AI
access through the paid channel instead of the open web. The sites that return an
HTTP 402 are mostly publishers in active litigation (the Penske Media titles suing
Google) or licensed elsewhere, using the 402 as a **defensive gate rather than an
open, payable rail**. The gate is going up everywhere; the toll booth that takes an
agent's money on demand is not.

## Provenance and license

Probes run June 28 2026 and backfilled July 4 2026; census pulled June 30 2026;
licensing status current to mid-2026. Data released under CC BY 4.0. Point-in-time
snapshot; gating configurations and licensing deals change.
