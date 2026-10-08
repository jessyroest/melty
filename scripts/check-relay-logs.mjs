#!/usr/bin/env node
// Static half of the "relay never logs" check (the runtime half is the
// "logging" test in relay/test/relay.test.ts, which spies on console):
//  - no console.* / logging calls anywhere in relay/src
//  - Workers observability (logs, traces) disabled, no logpush / tail consumers
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const relay = fileURLToPath(new URL("../relay", import.meta.url));
const problems = [];

for (const name of readdirSync(join(relay, "src"))) {
  const src = readFileSync(join(relay, "src", name), "utf8");
  src.split(/\r?\n/).forEach((line, i) => {
    if (/\bconsole\s*\.|\bdebugger\b|\bpostMessage\s*\(/.test(line)) problems.push(`src/${name}:${i + 1}: ${line.trim()}`);
  });
}

const config = readFileSync(join(relay, "wrangler.jsonc"), "utf8")
  .split(/\r?\n/)
  .map((l) => l.replace(/^\s*\/\/.*$/, ""))
  .join("\n");
const parsed = JSON.parse(config);
if (parsed.observability?.enabled !== false) problems.push("wrangler.jsonc: observability.enabled must be false");
if (parsed.observability?.logs?.enabled) problems.push("wrangler.jsonc: observability.logs enabled");
if (parsed.logpush) problems.push("wrangler.jsonc: logpush enabled");
if (parsed.tail_consumers?.length) problems.push("wrangler.jsonc: tail consumers configured");

if (problems.length) {
  console.error(`relay log check failed:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("relay log check ok: no logging calls in relay/src, observability off, no logpush or tail consumers.");
