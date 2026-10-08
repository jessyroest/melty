#!/usr/bin/env node
// Fails if the built web bundle (web/dist) references anything outside our own
// origin and relay. Run after `pnpm build`.
//
// 1. HTML: every src/href must be same-origin (relative). og:* metadata may
//    point at our own public origin.
// 2. CSS: every url() must be relative.
// 3. Anything URL-shaped in any file must be our relay, our public origin, or
//    one of a few known inert strings (listed below with the reason).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "web", "dist");

function readEnv() {
  const env = {};
  for (const f of [".env", ".env.local"]) {
    try {
      for (const line of readFileSync(join(root, "web", f), "utf8").split(/\r?\n/)) {
        const m = /^\s*([A-Z_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (m) env[m[1]] = m[2];
      }
    } catch {}
  }
  return { ...env, ...process.env };
}
const env = readEnv();
const relayOrigin = new URL(env.VITE_RELAY_URL || "ws://localhost:8787").origin;
const publicOrigin = new URL(env.VITE_PUBLIC_ORIGIN || "http://localhost:4173").origin;

/** strings that look like URLs but are never fetched */
const INERT = [
  [/^http:\/\/www\.w3\.org\/(2000\/svg|1999\/xlink|1999\/xhtml|1998\/Math\/MathML|XML\/1998\/namespace)$/, "XML namespace identifier"],
  [/^https:\/\/react\.dev\/errors\/$/, "React's minified error message text"],
];

const URLISH = /\b(?:https?|wss?):\/\/[^\s"'`)<>\\;,]+/g;
const problems = [];

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function allowed(u) {
  let origin;
  try {
    origin = new URL(u).origin;
  } catch {
    return false;
  }
  if (origin === relayOrigin || origin === publicOrigin) return true;
  return INERT.some(([re]) => re.test(u));
}

const files = walk(dist);
for (const file of files) {
  if (!/\.(html|js|css|json|txt|svg|webmanifest)$|_headers$/.test(file)) continue;
  const rel = relative(dist, file);
  const text = readFileSync(file, "utf8");

  for (const m of text.matchAll(URLISH)) {
    if (!allowed(m[0])) problems.push(`${rel}: external URL ${m[0]}`);
  }

  if (file.endsWith(".html")) {
    for (const m of text.matchAll(/\s(src|href)\s*=\s*["']([^"']+)["']/g)) {
      const v = m[2];
      if (!v.startsWith("/") || v.startsWith("//")) problems.push(`${rel}: ${m[1]}="${v}" is not same-origin`);
    }
    for (const m of text.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>/g)) problems.push(`${rel}: inline script ${m[0]}`);
    if (/<style\b/.test(text)) problems.push(`${rel}: inline <style>`);
    if (/\son[a-z]+\s*=/.test(text)) problems.push(`${rel}: inline event handler`);
  }

  if (file.endsWith(".css")) {
    for (const m of text.matchAll(/url\(\s*["']?([^"')]+)/g)) {
      const v = m[1];
      if (!v.startsWith("/") || v.startsWith("//")) problems.push(`${rel}: url(${v}) is not same-origin`);
    }
    if (/@import/.test(text)) problems.push(`${rel}: @import`);
  }

  if (file.endsWith(".js")) {
    if (/\bdata:(?:image|font|text|application)/.test(text)) problems.push(`${rel}: data: URI in script`);
  }
}

const n = files.length;
if (problems.length) {
  console.error(`bundle check failed (${problems.length}):\n  ` + problems.join("\n  "));
  process.exit(1);
}
console.log(`bundle check ok: ${n} files, only ${publicOrigin} and ${relayOrigin} referenced.`);
