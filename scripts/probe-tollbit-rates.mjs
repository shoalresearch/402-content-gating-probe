#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASELINE_PATH = path.join(ROOT, "data", "publisher_gating_probe.json");
const STAMP = process.env.PROBE_STAMP || new Date().toISOString().slice(0, 10);
const OUT_PATH = path.join(ROOT, "data", "raw", `tollbit_rate_responses_${STAMP}.json`);
const TIMEOUT_MS = Number.parseInt(process.env.PROBE_TIMEOUT_MS || "20000", 10);

async function loadApiKey() {
  if (process.env.TOLLBIT_API_KEY) return process.env.TOLLBIT_API_KEY;
  if (!process.env.TOLLBIT_ENV_FILE) return null;
  const envText = await readFile(path.resolve(process.env.TOLLBIT_ENV_FILE), "utf8");
  const line = envText.split(/\r?\n/).find((entry) => entry.startsWith("TOLLBIT_API_KEY="));
  if (!line) return null;
  const raw = line.slice("TOLLBIT_API_KEY=".length).trim();
  return raw.replace(/^(['"])(.*)\1$/, "$2");
}

const API_KEY = await loadApiKey();

if (!API_KEY) {
  process.stderr.write("TOLLBIT_API_KEY is required. Export it or pass TOLLBIT_ENV_FILE pointing to a private env file.\n");
  process.exit(2);
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function sanitizeBody(text) {
  // TollBit error bodies contain no credential by design. This is a final guard
  // against an upstream service ever reflecting the supplied key.
  return text.split(API_KEY).join("<redacted>").slice(0, 8_192);
}

async function queryRate(url) {
  const endpoint = `https://gateway.tollbit.com/dev/v2/rates/${encodeURIComponent(url)}`;
  const started = performance.now();
  try {
    const response = await fetch(endpoint, {
      headers: { TollbitKey: API_KEY, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw = await response.text();
    const body = sanitizeBody(raw);
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* preserve exact text */ }
    return {
      targetUrl: url,
      endpoint: endpoint.replace(encodeURIComponent(url), "{url}"),
      requestedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started),
      status: response.status,
      contentType: response.headers.get("content-type"),
      bodySha256: sha256(raw),
      body: parsed ?? body,
      error: null,
    };
  } catch (caught) {
    return {
      targetUrl: url,
      endpoint: endpoint.replace(encodeURIComponent(url), "{url}"),
      requestedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - started),
      status: null,
      contentType: null,
      bodySha256: null,
      body: null,
      error: caught instanceof Error ? `${caught.name}: ${caught.message}` : String(caught),
    };
  }
}

const baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
const targets = baseline
  .filter((row) => row["Gating Vendor"] === "TollBit" || row["Gating Manager"] === "TollBit")
  .map((row) => `https://${row.Domain}/`);

const startedAt = new Date().toISOString();
const results = [];
for (const target of targets) {
  const result = await queryRate(target);
  results.push(result);
  process.stderr.write(`${new URL(target).hostname} -> ${result.status ?? "ERR"}\n`);
}

const payload = {
  schemaVersion: 1,
  experiment: "tollbit-rate-availability-probe",
  stamp: STAMP,
  startedAt,
  completedAt: new Date().toISOString(),
  methodology: {
    endpoint: "GET https://gateway.tollbit.com/dev/v2/rates/{url}",
    authentication: "TollbitKey supplied at runtime; never serialized",
    targetSelection: "every baseline publisher labeled TollBit-managed",
    targetPath: "publisher homepage",
    payment: "none; rate lookup only",
  },
  summary: {
    targets: results.length,
    statusCounts: Object.fromEntries([...new Set(results.map((row) => String(row.status ?? "error")))].sort().map((status) => [
      status,
      results.filter((row) => String(row.status ?? "error") === status).length,
    ])),
    ratesReturned: results.filter((row) => row.status === 200).length,
  },
  results,
};

await mkdir(path.dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
process.stdout.write(`${path.relative(ROOT, OUT_PATH)}\n`);
