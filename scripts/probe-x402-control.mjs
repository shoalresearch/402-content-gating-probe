#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const STAMP = process.env.PROBE_STAMP || new Date().toISOString().slice(0, 10);
const OUT_PATH = path.join(ROOT, "data", "raw", `x402_positive_control_challenge_${STAMP}.json`);
const URL = "https://stableenrich.dev/api/exa/search";
const BODY = { query: "Shoal Research x402 publisher content gating experiment", numResults: 1 };

function decodeBase64Json(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
}

function validRequirement(item) {
  return item && typeof item === "object" &&
    typeof item.scheme === "string" && item.scheme.length > 0 &&
    typeof item.network === "string" && item.network.length > 0 &&
    typeof item.asset === "string" && item.asset.length > 0 &&
    typeof item.payTo === "string" && item.payTo.length > 0 &&
    (item.amount !== undefined || item.maxAmountRequired !== undefined);
}

const started = performance.now();
const response = await fetch(URL, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": "ShoalResearch-x402-control/1.0",
  },
  body: JSON.stringify(BODY),
  signal: AbortSignal.timeout(30_000),
});
const responseBody = await response.text();
const paymentRequired = response.headers.get("payment-required");
const parsed = paymentRequired ? decodeBase64Json(paymentRequired) : null;

const payload = {
  schemaVersion: 1,
  experiment: "known-x402-positive-control-unpaid",
  stamp: STAMP,
  requestedAt: new Date().toISOString(),
  durationMs: Math.round(performance.now() - started),
  request: { method: "POST", url: URL, body: BODY },
  response: {
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: (() => { try { return JSON.parse(responseBody); } catch { return responseBody; } })(),
    bodySha256: createHash("sha256").update(responseBody).digest("hex"),
    paymentRequiredHeader: paymentRequired,
    paymentRequiredHeaderSha256: paymentRequired ? createHash("sha256").update(paymentRequired).digest("hex") : null,
    parsedChallenge: parsed ? {
      x402Version: parsed.x402Version,
      resource: parsed.resource,
      accepts: parsed.accepts,
    } : null,
  },
  validPositiveControl: response.status === 402 && Number.isInteger(Number(parsed?.x402Version)) &&
    Array.isArray(parsed?.accepts) && parsed.accepts.some(validRequirement),
};

await mkdir(path.dirname(OUT_PATH), { recursive: true });
await writeFile(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
process.stdout.write(`${path.relative(ROOT, OUT_PATH)}\n`);
if (!payload.validPositiveControl) process.exitCode = 1;
