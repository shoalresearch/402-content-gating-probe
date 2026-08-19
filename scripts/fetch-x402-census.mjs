#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASELINE_PATH = path.join(ROOT, "data", "publisher_gating_probe.json");
const STAMP = process.env.PROBE_STAMP || new Date().toISOString().slice(0, 10);
const OUT_PATH = path.join(ROOT, "data", `x402_open_rail_census_${STAMP}.json`);
const RECEIPTS_PATH = path.join(ROOT, "data", "raw", `x402_registry_page_receipts_${STAMP}.json`);
const API = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
const PAGE_SIZE = 1_000;
const CONCURRENCY = Number.parseInt(process.env.CENSUS_CONCURRENCY || "4", 10);
const TIMEOUT_MS = Number.parseInt(process.env.PROBE_TIMEOUT_MS || "30000", 10);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function pageUrl(offset) {
  const url = new URL(API);
  url.searchParams.set("type", "http");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  return url.href;
}

async function fetchPage(offset) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const started = performance.now();
    try {
      const response = await fetch(pageUrl(offset), {
        headers: { accept: "application/json", "user-agent": "ShoalResearch-x402-census/1.0" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 240)}`);
      const parsed = JSON.parse(raw);
      return {
        offset,
        items: parsed.items || [],
        total: parsed.pagination?.total,
        receipt: {
          offset,
          url: pageUrl(offset),
          status: response.status,
          fetchedAt: new Date().toISOString(),
          durationMs: Math.round(performance.now() - started),
          itemCount: (parsed.items || []).length,
          responseBytes: Buffer.byteLength(raw),
          responseSha256: sha256(raw),
          pagination: parsed.pagination || null,
        },
      };
    } catch (caught) {
      lastError = caught;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw new Error(`offset ${offset}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
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

function hostFromResource(resource) {
  try { return new URL(resource).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return null; }
}

const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
const publisherDomains = baseline.map((row) => row.Domain.toLowerCase().replace(/^www\./, ""));
const startedAt = new Date().toISOString();
const first = await fetchPage(0);
const total = first.total;
if (!Number.isFinite(total)) throw new Error("registry response did not include pagination.total");

const offsets = [];
for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) offsets.push(offset);
let completed = 1;
process.stderr.write(`[1/${offsets.length + 1}] offset 0 -> ${first.items.length}\n`);
const rest = await mapLimit(offsets, CONCURRENCY, async (offset) => {
  const page = await fetchPage(offset);
  completed += 1;
  process.stderr.write(`[${completed}/${offsets.length + 1}] offset ${offset} -> ${page.items.length}\n`);
  return page;
});

const pages = [first, ...rest].sort((a, b) => a.offset - b.offset);
const items = pages.flatMap((page) => page.items);
if (items.length !== total) throw new Error(`incomplete registry: expected ${total}, fetched ${items.length}`);

const domains = new Map();
const networkBreakdown = {};
for (const item of items) {
  const host = hostFromResource(item.resource);
  if (!host) continue;
  const current = domains.get(host) || { domain: host, endpoints: 0, calls30d: 0, summedEndpointPayers30d: 0 };
  current.endpoints += 1;
  current.calls30d += Number(item.quality?.l30DaysTotalCalls || 0);
  current.summedEndpointPayers30d += Number(item.quality?.l30DaysUniquePayers || 0);
  domains.set(host, current);
  for (const requirement of item.accepts || []) {
    const network = String(requirement.network || "unknown");
    networkBreakdown[network] = (networkBreakdown[network] || 0) + 1;
  }
}

const domainRows = [...domains.values()].sort((a, b) =>
  b.calls30d - a.calls30d || b.summedEndpointPayers30d - a.summedEndpointPayers30d || a.domain.localeCompare(b.domain)
);
const publisherMatches = domainRows.filter((row) => publisherDomains.some((domain) =>
  row.domain === domain || row.domain.endsWith(`.${domain}`)
));

const census = {
  schemaVersion: 2,
  stamp: STAMP,
  source: API,
  startedAt,
  completedAt: new Date().toISOString(),
  totalEndpoints: items.length,
  distinctDomains: domainRows.length,
  domainsWithCalls: domainRows.filter((row) => row.calls30d > 0).length,
  totalPaidCalls30d: domainRows.reduce((sum, row) => sum + row.calls30d, 0),
  domainsWithAtLeast20SummedEndpointPayers30d: domainRows.filter((row) => row.summedEndpointPayers30d >= 20).length,
  networkAcceptanceOptions: Object.fromEntries(Object.entries(networkBreakdown).sort((a, b) => b[1] - a[1])),
  publisherMatchMethod: "registry host equals or is a subdomain of one of the 108 publisher domains",
  publisherDomainsChecked: publisherDomains.length,
  publisherDomainsFound: publisherMatches,
  caveats: [
    "The registry's payer metric is per endpoint. Summing it at domain level can double-count the same payer across endpoints.",
    "Network counts measure accepted payment options, not endpoints; one endpoint can accept multiple networks.",
    "Registry counts and rolling 30-day quality fields are point-in-time provider data, not independently reconstructed on-chain totals.",
  ],
  domains: domainRows,
};

const receipts = {
  schemaVersion: 1,
  stamp: STAMP,
  source: API,
  pageSize: PAGE_SIZE,
  totalExpected: total,
  totalFetched: items.length,
  pages: pages.map((page) => page.receipt),
};

await mkdir(path.dirname(OUT_PATH), { recursive: true });
await mkdir(path.dirname(RECEIPTS_PATH), { recursive: true });
await writeFile(OUT_PATH, `${JSON.stringify(census, null, 2)}\n`);
await writeFile(RECEIPTS_PATH, `${JSON.stringify(receipts, null, 2)}\n`);
process.stdout.write(`${path.relative(ROOT, OUT_PATH)}\n${path.relative(ROOT, RECEIPTS_PATH)}\n`);
