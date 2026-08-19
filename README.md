# x402 publisher content-gating probe

Public data and reproducible collection code for Shoal Research's publisher-gating
experiment, cited in **The Internet is Breaking**. The experiment asks whether a
major content provider will let an AI crawler pay for access on demand, and whether
an HTTP 402 response actually contains an open x402 payment challenge.

## Result: 2026-08-19 rerun

The headline result was reproduced: **0 of 108 publisher homepages returned a
valid x402 payment challenge.** Sixteen returned HTTP 402, but none supplied
machine-payable requirements in a `Payment-Required`/`X-Payment-Required` header
or JSON body.

| Observed result | Publishers |
| --- | ---: |
| Served the request for free | 53 |
| Blocked the AI user agent | 31 |
| Returned HTTP 402, not x402-payable | 16 |
| Network error or timeout after two attempts | 3 |
| Required authentication | 2 |
| Returned HTTP 406 | 2 |
| Returned HTTP 451 | 1 |
| **Total** | **108** |

Of the 16 HTTP 402 responses, 10 returned a TollBit token wall and 6 returned
a manual licensing or generic contact response. A second, authenticated check of
all 13 publishers labeled TollBit-managed in the baseline returned HTTP 403 for
every rate lookup, with the response that the content provider had disallowed
access to the page. No rate was returned.

As a positive control, the same run called a known x402 endpoint. The unpaid
request returned a valid x402 v2 challenge, and a subsequent $0.01 USDC payment on
Base returned the requested data. The settlement is independently inspectable in
the stored receipt and on
[BaseScan](https://basescan.org/tx/0xdf5ef8266b2edf073fbe85340fe037b5538de7295f007820848dd7eb657d85f2).
This shows that the test could recognize and complete an x402 flow; it does not
show that any publisher in the sample offered one.

## Fresh x402 registry census

The Coinbase CDP x402 discovery registry was paginated in full during the same
run. Page-level response hashes document collection completeness and integrity.

| Registry field | 2026-08-19 snapshot |
| --- | ---: |
| HTTP endpoints | 15,073 |
| Distinct domains | 1,570 |
| Domains with provider-reported 30-day calls | 1,561 |
| Sum of provider-reported 30-day endpoint calls | 317,660 |
| Matches among the 108 publisher domains | 0 |

These are point-in-time registry fields, not independently reconstructed on-chain
totals. The same payer may appear at more than one endpoint, and one endpoint may
advertise multiple networks. The earlier 2026-06-30 snapshot remains in the repo
for comparison; registry membership and aggregation changed between snapshots.

## Data files

- [`data/publisher_gating_probe_2026-08-19.csv`](data/publisher_gating_probe_2026-08-19.csv)
  and [JSON](data/publisher_gating_probe_2026-08-19.json): normalized results for
  all 108 publishers, including final status, classification, response evidence,
  hashes, baseline fields, and authenticated TollBit lookup results.
- [`data/publisher_402_responses_2026-08-19.csv`](data/publisher_402_responses_2026-08-19.csv):
  the 16 HTTP 402 responses in one reviewable table.
- [`data/raw/publisher_http_responses_2026-08-19.json`](data/raw/publisher_http_responses_2026-08-19.json):
  request configuration, redirect chains, selected response headers, retries,
  hashes, and capped error/challenge body evidence.
- [`data/raw/tollbit_rate_responses_2026-08-19.json`](data/raw/tollbit_rate_responses_2026-08-19.json):
  sanitized responses from the authenticated TollBit rate endpoint.
- [`data/x402_open_rail_census_2026-08-19.json`](data/x402_open_rail_census_2026-08-19.json)
  and [page receipts](data/raw/x402_registry_page_receipts_2026-08-19.json): the
  current registry census and a SHA-256 receipt for every fetched page.
- [`data/raw/x402_positive_control_challenge_2026-08-19.json`](data/raw/x402_positive_control_challenge_2026-08-19.json)
  and [paid result](data/x402_positive_control_paid_2026-08-19.json): the unpaid
  x402 challenge, paid API response, and successful Base transaction receipt.
- [`data/validation_report_2026-08-19.md`](data/validation_report_2026-08-19.md):
  machine-generated assertions and baseline differences.
- `data/publisher_gating_probe.csv` and `.json`: the June/July 2026 baseline,
  including separately researched AI-licensing annotations.

See [`METHODOLOGY.md`](METHODOLOGY.md) for the sample frame, classification rules,
collection sequence, limitations, and data-handling policy.

## Reproduce the collection

The scripts require Node.js 20 or newer and have no package dependencies.

```sh
export PROBE_STAMP=YYYY-MM-DD
npm run probe:publishers
npm run census:x402
npm run probe:x402-control
TOLLBIT_ENV_FILE=/absolute/path/to/private.env npm run probe:tollbit
npm run verify
```

The TollBit step needs a valid developer key in the private file shown in
`.env.example`. The paid positive control requires an x402-capable wallet or agent;
the exact AgentCash workflow used for this rerun is documented in
[`METHODOLOGY.md`](METHODOLOGY.md). No credential is written to an output file.

## Interpretation

An HTTP 402 status is evidence of a gate, not evidence that a requester can pay
it. This project marks a publisher as x402-payable only when the 402 response
contains parseable payment requirements. On 2026-08-19, that condition was false
for every publisher in the sample.

The sample is curated, English-language-heavy, and not a random census of the web.
It probes only the homepage, from one runner, with a GPTBot-formatted user agent.
Configurations can vary by URL, account, IP reputation, geography, and time. Three
publishers timed out after two attempts, so their current gate could not be
observed. Findings should be cited as a dated snapshot.

## License

Data, methodology, and code are released under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Attribute Shoal
Research and link to this repository. See [`LICENSE`](LICENSE).
