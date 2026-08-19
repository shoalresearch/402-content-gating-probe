# Methodology

This document describes the Shoal Research content-gating rerun performed on
2026-08-19. All timestamps in the stored artifacts are UTC.

## Research question

When a requester identifying as an AI crawler visits a major content provider:

1. Does the publisher serve, block, or gate the request?
2. If it returns HTTP 402, does the response contain a valid, open x402 payment
   challenge that a machine can satisfy without prior approval?
3. Do publishers previously associated with TollBit expose a rate through
   TollBit's authenticated developer API?
4. Are any of the same publisher domains present in the public Coinbase CDP x402
   discovery registry?

The crucial measurement rule is that **HTTP 402 is not treated as synonymous with
x402**. A response is x402-compliant in this experiment only when it has status
402 and contains parseable payment requirements in a standard payment header or
JSON body.

## Sample frame

The rerun reused the exact 108-domain baseline in
`data/publisher_gating_probe.json`; it did not select a new sample after observing
current responses. The baseline combines two deliberately overlapping frames:

- high-traffic content providers from 2026 category/ranking research; and
- publishers relevant to public AI-content licensing, litigation, or gating
  marketplaces.

Search engines, general portals, social networks, e-commerce, and streaming sites
were excluded. Content platforms such as Reddit, Wikipedia, Medium, Substack,
Stack Overflow, and WordPress were included.

This is a purposive sample, not a random web census. It is weighted toward
English-language publishers and includes editorial outlets whose influence may
exceed their traffic rank. The AI-licensing columns copied into the derived rerun
dataset are baseline annotations; they were not independently refreshed as part
of the 2026-08-19 HTTP experiment.

## 1. Publisher homepage probe

Collection ran from `2026-08-19T17:29:28.407Z` to
`2026-08-19T17:30:12.763Z`.

For every baseline domain, `scripts/probe-publishers.mjs` requested
`https://{domain}/` with:

- method `GET`;
- a browser-shaped GPTBot 1.0 user agent;
- `Accept`, `Accept-Language`, and `Cache-Control: no-cache` headers;
- manual recording and following of up to 8 redirects;
- a 20-second timeout per hop;
- up to 2 attempts when a network error occurred; and
- concurrency of 6 domains.

The request did not claim to originate from OpenAI infrastructure. It only used a
GPTBot-formatted user-agent string.

### Classification

- A 2xx response with no recognized bot-challenge marker was classified `Serves
  free`.
- A 2xx interstitial with recognized Cloudflare/Akamai-style challenge markers, or
  a final 403, 407, 409, 423, or 429, was classified `Blocks AI crawler`.
- Statuses 401, 402, 406, and 451 received distinct classifications.
- A request that still failed after the retry policy was classified
  `Error/timeout`.
- A 402 was marked `x402Compliant: true` only if a
  `Payment-Required`/`X-Payment-Required` header or JSON response body decoded to a
  versioned `accepts` or `paymentRequirements` structure with a scheme, network,
  amount, asset, and payment recipient.
- A non-x402 402 was labeled `tollbit`, `manual-contact`, or `opaque-402` from its
  redirect destination and response text.

### Evidence retained

The collector read at most the first 65,536 bytes of a response and stored a
SHA-256 hash of that sample. It retained response text only for errors and
challenges, capped at 4,096 characters. Successful article/homepage bodies were
not serialized. Only a fixed allowlist of diagnostic headers was stored;
authorization, cookies, and `Set-Cookie` were excluded.
Cloudflare client-IP fields and IPv4-like literals were replaced with explicit
redaction markers before serialization; the stored sample hash still represents
the original sampled bytes.

The raw artifact records the exact request configuration, redirects, selected
headers, attempt timings, errors, sample hashes, and challenge evidence. The
normalized JSON and CSV are generated from that raw artifact with
`scripts/build-publisher-dataset.mjs`.

## 2. Authenticated TollBit rate check

Collection ran from `2026-08-19T17:25:33.137Z` to
`2026-08-19T17:25:35.068Z`.

The script selected every baseline row whose gating manager or vendor was TollBit
(13 domains) and called:

```text
GET https://gateway.tollbit.com/dev/v2/rates/{publisher-homepage-url}
TollbitKey: <runtime credential>
```

The credential was loaded at runtime, never placed in the URL, and never written
to an artifact. Response serialization replaces any reflected occurrence of the
key with `<redacted>` and caps the body at 8,192 characters.

All 13 requests returned HTTP 403 with the response that the content provider had
disallowed access to the page. No HTTP 200 rate was returned. This result applies
to this credential, target URL, and collection time; it does not rule out private
rates or access for a differently approved account.

## 3. Coinbase CDP x402 registry census

Collection ran from `2026-08-19T17:26:13.184Z` to
`2026-08-19T17:26:19.567Z`.

`scripts/fetch-x402-census.mjs` paginated the public endpoint below with
`type=http`, a page size of 1,000, and numeric offsets until the advertised total
was reached:

```text
https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources
```

The run fetched all 15,073 advertised records across 16 pages. For each page, the
receipt file stores the URL, HTTP status, fetch time, item count, byte count,
pagination object, and SHA-256 hash of the exact response bytes. The published
census aggregates records by normalized hostname. A publisher matches when a
registry hostname equals or is a subdomain of one of the 108 sample domains.

The registry's rolling call and unique-payer values are provider-reported per
endpoint. Domain-level sums can double-count a payer used at several endpoints.
Network counts represent accepted payment options, so a multi-network endpoint is
counted more than once. These values were not independently reconstructed from
blockchain history.

## 4. x402 positive control and paid response

An unpaid `POST` was sent to the known x402 endpoint
`https://stableenrich.dev/api/exa/search` with this body:

```json
{
  "query": "Shoal Research x402 publisher content gating experiment",
  "numResults": 1
}
```

It returned HTTP 402 with a valid x402 v2 challenge accepting Base and Solana.
The raw `Payment-Required` value, its hash, the parsed challenge, and the response
body are stored in `data/raw/x402_positive_control_challenge_2026-08-19.json`.

The paid request used AgentCash after discovering the endpoint and inspecting its
schema. A default Solana attempt failed before settlement with
`BlockhashNotFound`. Retrying with `paymentProtocol=x402`,
`paymentNetwork=base`, and `maxAmount=0.02` paid $0.01 USDC and returned HTTP 200
with one result. No transaction was recorded for the failed attempt.

The successful transaction was
`0xdf5ef8266b2edf073fbe85340fe037b5538de7295f007820848dd7eb657d85f2`.
Its receipt was fetched from the public Base RPC with
`eth_getTransactionReceipt`; status `0x1` and the 10,000-atomic-unit USDC transfer
are recorded in `data/x402_positive_control_paid_2026-08-19.json`.

This positive control validates the challenge parser and end-to-end ability to pay
an x402 endpoint. It is not part of the publisher sample.

## Validation

`npm run build:data` deterministically produces the dated normalized JSON/CSV and
the 402-only CSV from the raw publisher and TollBit artifacts.

`npm run validate` checks, among other invariants:

- all 108 baseline domains appear exactly once;
- no publisher has a valid x402 challenge;
- every 402 retains evidence;
- sensitive response headers are absent;
- all 13 baseline TollBit targets were checked and no credential-shaped field was
  serialized;
- registry pagination is complete and every page has a SHA-256 receipt; and
- both the unpaid x402 challenge and paid Base settlement succeeded as controls.

The generated report is `data/validation_report_2026-08-19.md`. Validation is a
consistency check on the captured artifacts, not proof that remote servers will
return the same response later.

## Limitations

- The experiment probes one homepage per publisher, from one runner, at one time.
  Article paths or licensed feeds may behave differently.
- User-agent behavior can vary with geography, IP reputation, cookies, account
  status, JavaScript execution, and publisher configuration.
- No browser JavaScript was executed. Some 2xx interstitials may evade the simple
  marker classifier, while some blocks may apply to all automation rather than AI
  specifically.
- Three domains timed out after two attempts and therefore have no observed final
  response in this snapshot.
- A missing public rate does not disprove a private commercial agreement.
- HTTP responses and discovery registries change. Cite the collection date with
  any result.
