#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASELINE_PATH = path.join(ROOT, "data", "publisher_gating_probe.json");
const STAMP = process.env.PROBE_STAMP || new Date().toISOString().slice(0, 10);
const OUT_PATH = path.join(ROOT, "data", "raw", `publisher_http_responses_${STAMP}.json`);
const CONCURRENCY = positiveInt(process.env.PROBE_CONCURRENCY, 6);
const TIMEOUT_MS = positiveInt(process.env.PROBE_TIMEOUT_MS, 20_000);
const MAX_REDIRECTS = positiveInt(process.env.PROBE_MAX_REDIRECTS, 8);
const MAX_ATTEMPTS = positiveInt(process.env.PROBE_ATTEMPTS, 2);
const MAX_SAMPLE_BYTES = positiveInt(process.env.PROBE_MAX_SAMPLE_BYTES, 65_536);
const MAX_EVIDENCE_CHARS = positiveInt(process.env.PROBE_MAX_EVIDENCE_CHARS, 4_096);

const REQUEST_HEADERS = {
  "user-agent": "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.0; +https://openai.com/gptbot",
  accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.8",
  "cache-control": "no-cache",
};

const SAFE_RESPONSE_HEADERS = [
  "cache-control",
  "cf-cache-status",
  "cf-mitigated",
  "cf-ray",
  "content-length",
  "content-type",
  "date",
  "location",
  "payment-required",
  "retry-after",
  "server",
  "via",
  "www-authenticate",
  "x-payment-required",
  "x-robots-tag",
];

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeEvidence(value) {
  return value
    .replace(
      /(<[^>]*id=["']cf-footer-ip["'][^>]*>)[^<]*(<\/span>)/gi,
      "$1<redacted-client-ip>$2",
    )
    .replace(
      /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g,
      "<redacted-ipv4>",
    );
}

function selectedHeaders(headers) {
  const output = {};
  for (const name of SAFE_RESPONSE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) output[name] = value;
  }
  return output;
}

function decodePossibleBase64Json(value) {
  if (!value) return null;
  const candidates = [value];
  const match = value.match(/^\s*(?:x402\s+)?([A-Za-z0-9+/_=-]+)\s*$/i);
  if (match) candidates.push(match[1]);
  for (const candidate of candidates) {
    try {
      const normalized = candidate.replace(/-/g, "+").replace(/_/g, "/");
      const decoded = Buffer.from(normalized, "base64").toString("utf8");
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // A payment header may be plain JSON or another auth scheme.
    }
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function hasPaymentRequirements(value) {
  if (!value || typeof value !== "object") return false;
  if (!Number.isInteger(Number(value.x402Version))) return false;
  const requirements = Array.isArray(value.accepts)
    ? value.accepts
    : Array.isArray(value.paymentRequirements)
      ? value.paymentRequirements
      : value.paymentRequirements && typeof value.paymentRequirements === "object"
        ? [value.paymentRequirements]
        : [];
  return requirements.some((item) => item && typeof item === "object" &&
    typeof item.scheme === "string" && item.scheme.length > 0 &&
    typeof item.network === "string" && item.network.length > 0 &&
    typeof item.asset === "string" && item.asset.length > 0 &&
    typeof item.payTo === "string" && item.payTo.length > 0 &&
    (item.amount !== undefined || item.maxAmountRequired !== undefined));
}

function parseJson(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function classify(status, finalUrl, headers, sampleText, error) {
  if (error) return { response: "Error/timeout", challengeKind: null, x402Compliant: false };
  const lower = `${finalUrl}\n${sampleText}`.toLowerCase();
  const paymentHeader = headers["payment-required"] || headers["x-payment-required"] || "";
  const headerChallenge = decodePossibleBase64Json(paymentHeader);
  const bodyChallenge = parseJson(sampleText);
  const x402Compliant = status === 402 && (
    hasPaymentRequirements(headerChallenge) || hasPaymentRequirements(bodyChallenge)
  );

  const botChallenge = headers["cf-mitigated"] === "challenge" ||
    lower.includes("cf-chl-") ||
    lower.includes("<title>just a moment") ||
    lower.includes("enable javascript and cookies to continue") ||
    lower.includes("access denied | akamai");

  let response;
  if (status >= 200 && status < 300 && botChallenge) response = "Blocks AI crawler";
  else if (status >= 200 && status < 300) response = "Serves free";
  else if (status === 401) response = "Auth required";
  else if (status === 402) response = "Returned 402";
  else if (status === 406) response = "Not acceptable";
  else if (status === 451) response = "Legal/geo block";
  else if ([403, 407, 409, 423, 429].includes(status)) response = "Blocks AI crawler";
  else response = `Other HTTP ${status}`;

  let challengeKind = null;
  if (status === 402) {
    if (x402Compliant) challengeKind = "x402";
    else if (lower.includes("tollbit")) challengeKind = "tollbit";
    else if (lower.includes("contact") || lower.includes("email") || lower.includes("partnership")) challengeKind = "manual-contact";
    else challengeKind = "opaque-402";
  }

  return {
    response,
    challengeKind,
    x402Compliant,
    parsedPaymentHeader: hasPaymentRequirements(headerChallenge) ? headerChallenge : null,
    parsedPaymentBody: hasPaymentRequirements(bodyChallenge) ? bodyChallenge : null,
  };
}

async function readSample(response) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < MAX_SAMPLE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.byteLength, MAX_SAMPLE_BYTES - size);
      chunks.push(Buffer.from(value.buffer, value.byteOffset, take));
      size += take;
      if (take < value.byteLength || size >= MAX_SAMPLE_BYTES) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks);
}

async function requestOnce(url) {
  const startedAt = new Date().toISOString();
  const redirectChain = [];
  let current = url;
  let response;
  const started = performance.now();

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      response = await fetch(current, {
        method: "GET",
        headers: REQUEST_HEADERS,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const headers = selectedHeaders(response.headers);
      const location = response.headers.get("location");
      redirectChain.push({ url: current, status: response.status, headers });
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) break;
      if (hop === MAX_REDIRECTS) throw new Error(`redirect limit exceeded (${MAX_REDIRECTS})`);
      current = new URL(location, current).href;
      await response.body?.cancel().catch(() => {});
    }

    const sample = await readSample(response);
    const sampleText = sample.toString("utf8");
    const headers = selectedHeaders(response.headers);
    const classification = classify(response.status, current, headers, sampleText, null);
    const includeEvidence = response.status === 402 || response.status >= 400;
    return {
      requestedAt: startedAt,
      requestUrl: url,
      finalUrl: current,
      durationMs: Math.round(performance.now() - started),
      status: response.status,
      response: classification.response,
      challengeKind: classification.challengeKind,
      x402Compliant: classification.x402Compliant,
      parsedPaymentHeader: classification.parsedPaymentHeader,
      parsedPaymentBody: classification.parsedPaymentBody,
      headers,
      redirectChain,
      bodySampleBytes: sample.byteLength,
      bodySampleSha256: sha256(sample),
      bodyEvidence: includeEvidence ? sanitizeEvidence(sampleText.slice(0, MAX_EVIDENCE_CHARS)) : null,
      bodyTruncated: sample.byteLength >= MAX_SAMPLE_BYTES || sampleText.length > MAX_EVIDENCE_CHARS,
      error: null,
    };
  } catch (caught) {
    const error = caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught);
    const classification = classify(null, current, {}, "", error);
    return {
      requestedAt: startedAt,
      requestUrl: url,
      finalUrl: current,
      durationMs: Math.round(performance.now() - started),
      status: null,
      response: classification.response,
      challengeKind: null,
      x402Compliant: false,
      parsedPaymentHeader: null,
      parsedPaymentBody: null,
      headers: {},
      redirectChain,
      bodySampleBytes: 0,
      bodySampleSha256: null,
      bodyEvidence: null,
      bodyTruncated: false,
      error,
    };
  }
}

async function requestWithRetries(url) {
  const attempts = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await requestOnce(url);
    attempts.push({
      attempt,
      requestedAt: result.requestedAt,
      status: result.status,
      durationMs: result.durationMs,
      error: result.error,
    });
    if (!result.error || attempt === MAX_ATTEMPTS) return { ...result, attempts };
    await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  throw new Error("unreachable retry state");
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
const domains = baseline.map((row) => row.Domain);
const startedAt = new Date().toISOString();
let complete = 0;

const results = await mapLimit(domains, CONCURRENCY, async (domain) => {
  const result = await requestWithRetries(`https://${domain}/`);
  complete += 1;
  process.stderr.write(`[${complete}/${domains.length}] ${domain} -> ${result.status ?? "ERR"} ${result.response}\n`);
  return { domain, ...result };
});

const responseCounts = Object.fromEntries(
  [...new Set(results.map((row) => row.response))].sort().map((name) => [
    name,
    results.filter((row) => row.response === name).length,
  ]),
);

const payload = {
  schemaVersion: 1,
  experiment: "publisher-homepage-gptbot-probe",
  stamp: STAMP,
  startedAt,
  completedAt: new Date().toISOString(),
  methodology: {
    method: "GET",
    initialUrlTemplate: "https://{domain}/",
    headers: REQUEST_HEADERS,
    redirectMode: "manual-follow",
    maxRedirects: MAX_REDIRECTS,
    timeoutMsPerHop: TIMEOUT_MS,
    maxAttemptsOnNetworkError: MAX_ATTEMPTS,
    concurrency: CONCURRENCY,
    bodyCapture: `first ${MAX_SAMPLE_BYTES} bytes; evidence text retained only for HTTP errors/challenges and capped at ${MAX_EVIDENCE_CHARS} characters`,
    evidenceRedaction: "Cloudflare client-IP fields and IPv4-like literals are replaced before serialization",
    excludedHeaders: "credentials, cookies, and set-cookie are never stored",
    x402Test: "HTTP 402 plus parseable payment requirements in Payment-Required/X-Payment-Required header or JSON body",
  },
  summary: {
    domains: results.length,
    responseCounts,
    http402Count: results.filter((row) => row.status === 402).length,
    x402CompliantCount: results.filter((row) => row.x402Compliant).length,
    errors: results.filter((row) => row.error).length,
  },
  results,
};

await mkdir(path.dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
process.stdout.write(`${path.relative(ROOT, OUT_PATH)}\n`);
