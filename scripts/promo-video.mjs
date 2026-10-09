#!/usr/bin/env node
// Renders the promo video (web/promo) to an MP4, frame by frame, with a local
// Chromium (playwright-core) and ffmpeg. Nothing is downloaded.
//   node scripts/promo-video.mjs [out.mp4]
//   STILLS=1,5,12.5 node scripts/promo-video.mjs   → just those moments, as PNGs
// BROWSER_PATH=… or BROWSER_CHANNEL=chrome|msedge picks the browser; FPS (default 30).
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const web = fileURLToPath(new URL("../web/", import.meta.url));
const dist = join(web, "dist-promo");
const out = resolve(process.argv[2] ?? "melty-promo.mp4");
const FPS = Number(process.env.FPS ?? 30);
const stills = process.env.STILLS?.split(",").map(Number);

execFileSync("npx", ["vite", "build", "--config", "promo/vite.config.ts", "--logLevel", "warn"], { cwd: web, stdio: "inherit" });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const p = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
  const file = existsSync(p) && statSync(p).isFile() ? p : join(dist, "index.html");
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch(
  process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: process.env.BROWSER_CHANNEL ?? "msedge" },
);
const frames = mkdtempSync(join(tmpdir(), "melty-promo-"));
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  const duration = await page.evaluate(() => window.DURATION);
  const times = stills ?? Array.from({ length: Math.round(duration * FPS) }, (_, i) => i / FPS);
  for (const [i, t] of times.entries()) {
    await page.evaluate((t) => window.renderAt(t), t);
    const path = stills ? out.replace(/\.mp4$/, "") + `-${t}.png` : join(frames, `f${String(i).padStart(5, "0")}.png`);
    await page.screenshot({ path });
    if (!stills && i % FPS === 0) process.stdout.write(`\r${Math.round((i / times.length) * 100)}%`);
  }
  if (!stills) {
    process.stdout.write("\rencoding…\n");
    mkdirSync(resolve(out, ".."), { recursive: true });
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error",
      "-framerate", String(FPS), "-i", join(frames, "f%05d.png"),
      "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      out,
    ], { stdio: "inherit" });
    console.log(`wrote ${out}`);
  }
} finally {
  await browser.close();
  server.close();
  rmSync(frames, { recursive: true, force: true });
}
