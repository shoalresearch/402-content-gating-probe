#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const STAMP = process.env.PROBE_STAMP || new Date().toISOString().slice(0, 10);

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(ROOT, relativePath), "utf8"));
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  return `${columns.map(csvCell).join(",")}\n${rows
    .map((row) => columns.map((column) => csvCell(row[column])).join(","))
    .join("\n")}\n`;
}

function domainFromUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function compactEvidence(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : value;
}

const baseline = await readJson("data/publisher_gating_probe.json");
const probe = await readJson(`data/raw/publisher_http_responses_${STAMP}.json`);
const tollbit = await readJson(`data/raw/tollbit_rate_responses_${STAMP}.json`);

const baselineByDomain = new Map(baseline.map((row) => [row.Domain, row]));
const tollbitByDomain = new Map(
  tollbit.results.map((row) => [domainFromUrl(row.targetUrl), row]),
);

const results = probe.results.map((row) => {
  const prior = baselineByDomain.get(row.domain) || {};
  const rateLookup = tollbitByDomain.get(row.domain);
  return {
    domain: row.domain,
    requestedAt: row.requestedAt,
    requestUrl: row.requestUrl,
    finalUrl: row.finalUrl,
    httpStatus: row.status,
    response: row.response,
    challengeType: row.challengeKind,
    x402Compliant: row.x402Compliant,
    x402PayableInProbe: row.x402Compliant === true,
    redirectCount: Math.max(0, (row.redirectChain?.length || 1) - 1),
    attempts: row.attempts?.length || 1,
    durationMs: row.durationMs,
    error: row.error,
    selectedResponseHeaders: row.headers,
    responseEvidence: row.bodyEvidence,
    responseSampleSha256: row.bodySampleSha256,
    responseSampleOrEvidenceTruncated: row.bodyTruncated,
    baselineHttpStatus: prior["HTTP Status"] ?? null,
    baselineResponse: prior.Response ?? null,
    baselineGatingManager: prior["Gating Manager"] || null,
    baselineGatingVendor: prior["Gating Vendor"] || null,
    baselineAiLicensingStatus: prior["AI Licensing Status"] || null,
    baselineAiCounterparties: prior["AI Counterparties"] || null,
    tollbitRateHttpStatus: rateLookup?.status ?? null,
    tollbitRateResponse: rateLookup?.body ?? null,
  };
});

const payload = {
  schemaVersion: 1,
  experiment: "publisher-homepage-gptbot-probe-derived-dataset",
  stamp: STAMP,
  source: `data/raw/publisher_http_responses_${STAMP}.json`,
  sourceCompletedAt: probe.completedAt,
  note: "x402PayableInProbe is true only when a valid x402 payment challenge was observed; HTTP 402 alone is insufficient",
  results,
};

const csvRows = results.map((row) => ({
  Domain: row.domain,
  "Requested At": row.requestedAt,
  "Final URL": row.finalUrl,
  "HTTP Status": row.httpStatus,
  Response: row.response,
  "Challenge Type": row.challengeType,
  "x402 Compliant": row.x402Compliant,
  "x402 Payable in Probe": row.x402PayableInProbe,
  Redirects: row.redirectCount,
  Attempts: row.attempts,
  "Duration ms": row.durationMs,
  Error: row.error,
  "Response Evidence": compactEvidence(row.responseEvidence),
  "Response Sample SHA-256": row.responseSampleSha256,
  "Baseline HTTP Status": row.baselineHttpStatus,
  "Baseline Response": row.baselineResponse,
  "Baseline Gating Vendor": row.baselineGatingVendor,
  "AI Licensing Status (baseline)": row.baselineAiLicensingStatus,
  "AI Counterparties (baseline)": row.baselineAiCounterparties,
  "TollBit Rate HTTP Status": row.tollbitRateHttpStatus,
  "TollBit Rate Response": row.tollbitRateResponse,
}));

const challengeRows = csvRows.filter((row) => row["HTTP Status"] === 402);
const jsonPath = path.join(ROOT, "data", `publisher_gating_probe_${STAMP}.json`);
const csvPath = path.join(ROOT, "data", `publisher_gating_probe_${STAMP}.csv`);
const challengesPath = path.join(ROOT, "data", `publisher_402_responses_${STAMP}.csv`);

await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
await writeFile(csvPath, toCsv(csvRows));
await writeFile(challengesPath, toCsv(challengeRows));

process.stdout.write(
  `${path.relative(ROOT, jsonPath)}\n${path.relative(ROOT, csvPath)}\n${path.relative(ROOT, challengesPath)}\n`,
);
