#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const STAMP = process.env.PROBE_STAMP || new Date().toISOString().slice(0, 10);

async function readJson(relative) {
  return JSON.parse(await readFile(path.join(ROOT, relative), "utf8"));
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) {
    const value = String(row[key] ?? "unknown");
    counts[value] = (counts[value] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort());
}

const baseline = await readJson("data/publisher_gating_probe.json");
const rerun = await readJson(`data/raw/publisher_http_responses_${STAMP}.json`);
const tollbit = await readJson(`data/raw/tollbit_rate_responses_${STAMP}.json`);
const census = await readJson(`data/x402_open_rail_census_${STAMP}.json`);
const receipts = await readJson(`data/raw/x402_registry_page_receipts_${STAMP}.json`);
const x402Unpaid = await readJson(`data/raw/x402_positive_control_challenge_${STAMP}.json`);
const x402Paid = await readJson(`data/x402_positive_control_paid_${STAMP}.json`);

const baselineByDomain = new Map(baseline.map((row) => [row.Domain, row]));
const http402Rows = rerun.results.filter((row) => row.status === 402);
const ipv4Pattern = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/;
const forbiddenHeaderNames = new Set(["authorization", "cookie", "set-cookie"]);
const hasForbiddenHeader = (row) => [
  row.headers || {},
  ...(row.redirectChain || []).map((hop) => hop.headers || {}),
].some((headers) => Object.keys(headers).some((name) => forbiddenHeaderNames.has(name.toLowerCase())));
const changes = rerun.results.map((row) => {
  const prior = baselineByDomain.get(row.domain);
  return {
    domain: row.domain,
    baselineStatus: prior?.["HTTP Status"] ?? null,
    rerunStatus: row.status === null ? "ERR" : String(row.status),
    baselineResponse: prior?.Response ?? null,
    rerunResponse: row.response,
    changed: String(prior?.["HTTP Status"] ?? "") !== (row.status === null ? "ERR" : String(row.status)),
    rerunChallengeKind: row.challengeKind,
    rerunX402Compliant: row.x402Compliant,
  };
});

const assertions = [
  { name: "same publisher frame", pass: rerun.results.length === baseline.length, detail: `${rerun.results.length}/${baseline.length}` },
  { name: "same publisher identities", pass: new Set(rerun.results.map((row) => row.domain)).size === baseline.length && rerun.results.every((row) => baselineByDomain.has(row.domain)), detail: `${new Set(rerun.results.map((row) => row.domain)).size} unique` },
  { name: "no publisher returned a valid x402 challenge", pass: rerun.summary.x402CompliantCount === 0, detail: `${rerun.summary.x402CompliantCount} compliant` },
  { name: "every HTTP 402 retained challenge evidence", pass: http402Rows.every((row) => row.bodyEvidence), detail: `${http402Rows.filter((row) => row.bodyEvidence).length}/${rerun.summary.http402Count}` },
  { name: "sensitive HTTP headers excluded", pass: rerun.results.every((row) => !hasForbiddenHeader(row)), detail: "authorization/cookie/set-cookie absent from final and redirect headers" },
  { name: "client IPv4 evidence redacted", pass: rerun.results.every((row) => !ipv4Pattern.test(row.bodyEvidence || "")) && Boolean(rerun.methodology.evidenceRedaction), detail: "no IPv4 literal remains in serialized body evidence" },
  { name: "all baseline TollBit publishers were rate-checked", pass: tollbit.summary.targets === baseline.filter((row) => row["Gating Vendor"] === "TollBit" || row["Gating Manager"] === "TollBit").length, detail: `${tollbit.summary.targets} targets` },
  { name: "TollBit credential material not serialized", pass: tollbit.results.every((row) => !Object.keys(row).some((name) => /key|token|authorization|headers/i.test(name)) && !JSON.stringify(row.body).match(/Bearer\s+[A-Za-z0-9._-]{12,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/)), detail: "credential-bearing fields and JWT-like values absent" },
  { name: "x402 registry fetched completely", pass: census.totalEndpoints > 0 && receipts.totalExpected === receipts.totalFetched && receipts.totalFetched === census.totalEndpoints, detail: `${receipts.totalFetched}/${receipts.totalExpected}` },
  { name: "x402 registry pages have verifiable receipts", pass: receipts.pages.length > 0 && receipts.pages.every((page) => page.status === 200 && /^[a-f0-9]{64}$/.test(page.responseSha256)), detail: `${receipts.pages.length} pages` },
  { name: "known x402 endpoint returned a valid unpaid challenge", pass: x402Unpaid.validPositiveControl === true && x402Unpaid.response.status === 402 && x402Unpaid.response.parsedChallenge?.accepts?.length > 0, detail: `${x402Unpaid.response.parsedChallenge?.accepts?.length || 0} payment options` },
  { name: "known x402 endpoint returned data after payment", pass: x402Paid.response.status === 200 && x402Paid.attempts.some((attempt) => attempt.result === "success"), detail: `${x402Paid.response.body.results?.length || 0} result(s)` },
  { name: "paid control has a successful Base receipt", pass: x402Paid.onchainReceipt.status === "0x1" && x402Paid.onchainReceipt.transactionHash === x402Paid.attempts.find((attempt) => attempt.result === "success")?.transactionHash, detail: x402Paid.onchainReceipt.transactionHash },
];

const report = {
  schemaVersion: 1,
  stamp: STAMP,
  pass: assertions.every((item) => item.pass),
  assertions,
  baseline: {
    stamp: "2026-06-28 to 2026-07-04",
    domains: baseline.length,
    statusCounts: countBy(baseline, "HTTP Status"),
    responseCounts: countBy(baseline, "Response"),
  },
  rerun: {
    stamp: STAMP,
    domains: rerun.results.length,
    statusCounts: countBy(rerun.results.map((row) => ({ status: row.status ?? "ERR" })), "status"),
    responseCounts: countBy(rerun.results, "response"),
    http402Count: rerun.summary.http402Count,
    http402ChallengeTypeCounts: countBy(http402Rows, "challengeKind"),
    x402CompliantCount: rerun.summary.x402CompliantCount,
    errors: rerun.summary.errors,
    errorDomains: rerun.results.filter((row) => row.error).map((row) => row.domain),
  },
  tollbit: tollbit.summary,
  census: {
    totalEndpoints: census.totalEndpoints,
    distinctDomains: census.distinctDomains,
    domainsWithCalls: census.domainsWithCalls,
    totalPaidCalls30d: census.totalPaidCalls30d,
    publisherDomainsChecked: census.publisherDomainsChecked,
    publisherDomainsFound: census.publisherDomainsFound,
  },
  x402PositiveControl: {
    unpaidStatus: x402Unpaid.response.status,
    x402Version: x402Unpaid.response.parsedChallenge?.x402Version,
    acceptedNetworks: (x402Unpaid.response.parsedChallenge?.accepts || []).map((item) => item.network),
    paidStatus: x402Paid.response.status,
    priceUsd: x402Paid.challenge.priceUsd,
    transactionHash: x402Paid.onchainReceipt.transactionHash,
    receiptStatus: x402Paid.onchainReceipt.status,
  },
  changes,
};

const jsonPath = path.join(ROOT, "data", `validation_report_${STAMP}.json`);
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

const changedRows = changes.filter((row) => row.changed);
const markdown = `# Validation report — ${STAMP}\n\n` +
  `Overall: **${report.pass ? "PASS" : "FAIL"}**\n\n` +
  `## Assertions\n\n` +
  assertions.map((item) => `- ${item.pass ? "PASS" : "FAIL"}: ${item.name} (${item.detail})`).join("\n") +
  `\n\n## Publisher probe\n\n` +
  `- Domains: ${rerun.results.length}\n` +
  `- HTTP 402 responses: ${rerun.summary.http402Count}\n` +
  `- HTTP 402 types: ${JSON.stringify(countBy(http402Rows, "challengeKind"))}\n` +
  `- Valid x402 challenges: ${rerun.summary.x402CompliantCount}\n` +
  `- Network errors/timeouts: ${rerun.summary.errors}\n` +
  `- Error/timeout domains: ${rerun.results.filter((row) => row.error).map((row) => row.domain).join(", ")}\n` +
  `- Domains whose final status changed from the baseline: ${changedRows.length}\n\n` +
  `## TollBit rate lookups\n\n` +
  `- Targets: ${tollbit.summary.targets}\n` +
  `- Rates returned (HTTP 200): ${tollbit.summary.ratesReturned}\n` +
  `- Status counts: ${JSON.stringify(tollbit.summary.statusCounts)}\n\n` +
  `## Coinbase x402 discovery registry\n\n` +
  `- HTTP endpoints: ${census.totalEndpoints.toLocaleString("en-US")}\n` +
  `- Distinct domains: ${census.distinctDomains.toLocaleString("en-US")}\n` +
  `- Publisher domains checked: ${census.publisherDomainsChecked}\n` +
  `- Publisher-domain matches: ${census.publisherDomainsFound.length}\n` +
  `- Provider-reported calls in rolling 30-day fields: ${census.totalPaidCalls30d.toLocaleString("en-US")}\n\n` +
  `## x402 positive control\n\n` +
  `- Unpaid response: HTTP ${x402Unpaid.response.status}, x402 v${x402Unpaid.response.parsedChallenge?.x402Version}\n` +
  `- Accepted networks: ${(x402Unpaid.response.parsedChallenge?.accepts || []).map((item) => item.network).join(", ")}\n` +
  `- Paid response: HTTP ${x402Paid.response.status}\n` +
  `- Price: $${x402Paid.challenge.priceUsd.toFixed(2)}\n` +
  `- Base transaction: ${x402Paid.onchainReceipt.transactionHash}\n` +
  `- Receipt status: ${x402Paid.onchainReceipt.status}\n\n` +
  `## Changed final statuses\n\n` +
  (changedRows.length
    ? `| Domain | Baseline | Rerun | Rerun classification |\n| --- | ---: | ---: | --- |\n${changedRows.map((row) => `| ${row.domain} | ${row.baselineStatus} | ${row.rerunStatus} | ${row.rerunResponse} |`).join("\n")}\n`
    : "No final HTTP statuses changed.\n");

const markdownPath = path.join(ROOT, "data", `validation_report_${STAMP}.md`);
await writeFile(markdownPath, markdown);
process.stdout.write(`${path.relative(ROOT, jsonPath)}\n${path.relative(ROOT, markdownPath)}\n`);
if (!report.pass) process.exitCode = 1;
