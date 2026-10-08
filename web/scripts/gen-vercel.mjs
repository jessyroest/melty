#!/usr/bin/env node
// Writes web/vercel.json with the same security headers as `vite preview` and
// Cloudflare Pages, plus SPA rewrites. Run with VITE_RELAY_URL set to your relay:
//   VITE_RELAY_URL=wss://relay.example.workers.dev pnpm --filter @melty/web gen:vercel
import { writeFileSync } from "node:fs";
import { securityHeaders } from "../headers.mjs";

const relay = process.env.VITE_RELAY_URL;
if (!relay) {
  console.error("set VITE_RELAY_URL (e.g. wss://melty-relay.<you>.workers.dev)");
  process.exit(1);
}
const headers = Object.entries(securityHeaders(relay)).map(([key, value]) => ({ key, value }));
const config = {
  buildCommand: "pnpm build",
  outputDirectory: "dist",
  headers: [{ source: "/(.*)", headers }],
  rewrites: [{ source: "/(r|how)", destination: "/index.html" }],
};
writeFileSync(new URL("../vercel.json", import.meta.url), JSON.stringify(config, null, 2) + "\n");
console.log("wrote web/vercel.json");
