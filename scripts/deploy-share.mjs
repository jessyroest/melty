#!/usr/bin/env node
// Deploy a shareable copy of melty to Cloudflare Workers: one public HTTPS
// origin (https://melty.<subdomain>.workers.dev) that serves the web app as
// static assets and runs the relay on /rooms/<id>/ws.
//
//   pnpm deploy:share                  # with `wrangler login` / CLOUDFLARE_API_TOKEN
//   pnpm deploy:share -- --temporary   # no login: 60-minute temporary account
//                                      # (open the printed claim URL to keep it)
//
// Steps:
//   1. build web/ into web/dist-share (never web/dist, local preview uses that)
//      with VITE_RELAY_URL=wss://<host>, VITE_PUBLIC_ORIGIN=https://<host>;
//      the build also writes dist-share/_headers (CSP etc. from web/headers.mjs)
//   2. set ALLOWED_ORIGINS=https://<host> in relay/wrangler.share.jsonc
//   3. wrangler deploy -c relay/wrangler.share.jsonc
//   4. if the URL wrangler reports differs from <host> (first run), repeat 1-3
//
// <host> starts as SHARE_HOST, else whatever wrangler.share.jsonc already has.
// Extra arguments are passed on to `wrangler deploy`.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../web/", import.meta.url));
const relay = fileURLToPath(new URL("../relay/", import.meta.url));
const configPath = fileURLToPath(new URL("../relay/wrangler.share.jsonc", import.meta.url));
const ORIGIN_LINE = /("ALLOWED_ORIGINS":\s*")[^"]*(")/;
const URL_RE = /https:\/\/melty\.[a-z0-9-]+\.workers\.dev/;
const extraArgs = process.argv.slice(2);

/** run a command, echo its output, resolve with stdout+stderr text */
function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, shell: process.platform === "win32", stdio: ["inherit", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
    child.stderr.on("data", (d) => { out += d; process.stderr.write(d); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`))));
  });
}

function currentHost() {
  if (process.env.SHARE_HOST) return process.env.SHARE_HOST;
  const origin = /"ALLOWED_ORIGINS":\s*"([^",]*)/.exec(readFileSync(configPath, "utf8"))[1];
  return new URL(origin).host;
}

async function buildAndDeploy(host) {
  console.log(`\n== build web/dist-share for https://${host}`);
  await run("pnpm", ["exec", "vite", "build", "--outDir", "dist-share"], {
    cwd: web,
    env: { ...process.env, VITE_RELAY_URL: `wss://${host}`, VITE_PUBLIC_ORIGIN: `https://${host}` },
  });
  const config = readFileSync(configPath, "utf8");
  writeFileSync(configPath, config.replace(ORIGIN_LINE, `$1https://${host}$2`));
  console.log(`\n== deploy (ALLOWED_ORIGINS=https://${host})`);
  const out = await run("pnpm", ["exec", "wrangler", "deploy", "-c", "wrangler.share.jsonc", ...extraArgs], { cwd: relay });
  const url = URL_RE.exec(out)?.[0];
  if (!url) throw new Error("could not find the workers.dev URL in wrangler's output");
  return new URL(url).host;
}

let host = currentHost();
const deployed = await buildAndDeploy(host);
if (deployed !== host) {
  console.log(`\n== deployed at ${deployed}, rebuilding for that origin`);
  host = deployed;
  if ((await buildAndDeploy(host)) !== host) throw new Error("workers.dev URL changed between deploys");
}
console.log(`\nshare link: https://${host}/`);
