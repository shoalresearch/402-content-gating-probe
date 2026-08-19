# Validation report — 2026-08-19

Overall: **PASS**

## Assertions

- PASS: same publisher frame (108/108)
- PASS: same publisher identities (108 unique)
- PASS: no publisher returned a valid x402 challenge (0 compliant)
- PASS: every HTTP 402 retained challenge evidence (16/16)
- PASS: sensitive HTTP headers excluded (authorization/cookie/set-cookie absent from final and redirect headers)
- PASS: client IPv4 evidence redacted (no IPv4 literal remains in serialized body evidence)
- PASS: all baseline TollBit publishers were rate-checked (13 targets)
- PASS: TollBit credential material not serialized (credential-bearing fields and JWT-like values absent)
- PASS: x402 registry fetched completely (15073/15073)
- PASS: x402 registry pages have verifiable receipts (16 pages)
- PASS: known x402 endpoint returned a valid unpaid challenge (2 payment options)
- PASS: known x402 endpoint returned data after payment (1 result(s))
- PASS: paid control has a successful Base receipt (0xdf5ef8266b2edf073fbe85340fe037b5538de7295f007820848dd7eb657d85f2)

## Publisher probe

- Domains: 108
- HTTP 402 responses: 16
- HTTP 402 types: {"manual-contact":6,"tollbit":10}
- Valid x402 challenges: 0
- Network errors/timeouts: 3
- Error/timeout domains: telegraph.co.uk, washingtonpost.com, npr.org
- Domains whose final status changed from the baseline: 11

## TollBit rate lookups

- Targets: 13
- Rates returned (HTTP 200): 0
- Status counts: {"403":13}

## Coinbase x402 discovery registry

- HTTP endpoints: 15,073
- Distinct domains: 1,570
- Publisher domains checked: 108
- Publisher-domain matches: 0
- Provider-reported calls in rolling 30-day fields: 317,660

## x402 positive control

- Unpaid response: HTTP 402, x402 v2
- Accepted networks: eip155:8453, solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
- Paid response: HTTP 200
- Price: $0.01
- Base transaction: 0xdf5ef8266b2edf073fbe85340fe037b5538de7295f007820848dd7eb657d85f2
- Receipt status: 0x1

## Changed final statuses

| Domain | Baseline | Rerun | Rerun classification |
| --- | ---: | ---: | --- |
| cnet.com | 403 | 200 | Serves free |
| people.com | 403 | 402 | Returned 402 |
| fastcompany.com | 403 | 402 | Returned 402 |
| allrecipes.com | 403 | 402 | Returned 402 |
| seriouseats.com | 403 | 402 | Returned 402 |
| stackoverflow.com | 200 | 403 | Blocks AI crawler |
| espn.com | 200 | 202 | Serves free |
| inc.com | 403 | 402 | Returned 402 |
| imdb.com | 202 | 403 | Blocks AI crawler |
| investopedia.com | 403 | 402 | Returned 402 |
| wordpress.com | 200 | 403 | Blocks AI crawler |
