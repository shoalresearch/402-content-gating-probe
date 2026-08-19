# Raw evidence

These artifacts are the direct, sanitized outputs of the 2026-08-19 collectors.

| File | Contents |
| --- | --- |
| `publisher_http_responses_2026-08-19.json` | Request configuration and one result per publisher: redirects, selected headers, retries, status, classification, sample hash, and capped challenge/error evidence. |
| `tollbit_rate_responses_2026-08-19.json` | Authenticated rate-lookup status and response body for each baseline TollBit target. The runtime key is not stored. |
| `x402_registry_page_receipts_2026-08-19.json` | Completeness metadata and SHA-256 receipt for each public registry page. |
| `x402_positive_control_challenge_2026-08-19.json` | Unpaid request, raw and parsed x402 challenge, response, and hashes. |

Successful publisher response bodies were not retained. Challenge/error evidence
is capped at 4,096 characters, and authorization, cookies, and `Set-Cookie` are
excluded. Hashes for publisher responses cover the sampled bytes, not necessarily
the complete remote body. Cloudflare client-IP fields and IPv4-like literals are
replaced with redaction markers; hashes still represent the original sample. See
the root `METHODOLOGY.md` for exact limits.
