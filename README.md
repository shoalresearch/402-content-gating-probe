# x402 / AI Content-Gating Probe -- Top Publishers

Dataset behind Shoal Research's essay **The Internet is Breaking**. It answers one
question empirically: when an AI agent shows up at a major publisher, what happens,
who is managing the gate, and can the agent actually pay to get in?

## What is here

- `data/publisher_gating_probe.csv` -- 97 top publishers and consumer sites, each
  probed with the GPTBot user agent. Columns: domain, gating manager, gating vendor,
  HTTP status, response type, whether it is licensable, whether Cloudflare fronts it,
  the observed challenge, and (for TollBit-managed sites) the result of a real
  TollBit API token test.
- `data/x402_open_rail_census_2026-06-30.json` -- the full Coinbase x402 discovery
  registry pulled on June 30 2026 and cross-checked against on-chain settlement on
  Base (22,469 payable endpoints across 1,154 domains).

## Method

Each publisher homepage was requested with the GPTBot user agent and the raw HTTP
status and body were recorded. Sites listed on TollBit were then tested with a valid
TollBit developer key and a registered agent, requesting content through the TollBit
gateway. The open-rail census was built by paginating the Coinbase x402 discovery
API in full and confirming settlement on Base.

## Headline finding

Of 97 top publishers probed, **zero exposed an open, payable x402 rate**. Every site
that answered with an HTTP 402 (8 of them) returned "rate not found for license
type", meaning TollBit whitelist or private-license only, or a manual email gate.
Roughly 31 blocked the AI crawler outright and 51 served content for free.
TollBit manages the gate on 12 of them, always behind an approval, never on an
open rate.

Response breakdown: Serves free (51), Blocks AI crawler (31), Charges (402) (8), Error/timeout (3), Auth required (2), Legal/geo block (1), Not acceptable (1).

## Provenance and license

Probes run June 28 2026; census pulled June 30 2026. Data released under CC BY 4.0.
Point-in-time snapshot; gating configurations change.
