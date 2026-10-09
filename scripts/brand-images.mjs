#!/usr/bin/env node
// Builds the brand images from sources in the repo, with a local Chromium through
// playwright-core (nothing is downloaded):
//   web/public/brand/og.jpg           1200×630: the generated OG art (web/design-src/og-raw.png)
//                                     with the melty cube and wordmark, set in the self-hosted Quicksand
//   web/public/icons/icon-*.png       app icons for the PWA manifest, from web/public/favicon.svg
//   node scripts/brand-images.mjs     (BROWSER_PATH=… or BROWSER_CHANNEL=chrome|msedge)
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const web = (p) => fileURLToPath(new URL(`../web/${p}`, import.meta.url));
const b64 = (p) => readFileSync(web(p)).toString("base64");
const cube = readFileSync(web("public/favicon.svg"), "utf8");
const font = b64("node_modules/@fontsource-variable/quicksand/files/quicksand-latin-wght-normal.woff2");
const art = b64("design-src/og-raw.png");

const html = `<!doctype html><html><head><style>
@font-face { font-family: Q; src: url(data:font/woff2;base64,${font}) format("woff2"); font-weight: 300 700; }
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #0a1024; }
.art { position: absolute; left: 50%; top: 50%; width: 1344px; height: 752px; transform: translate(-50%, -50%) translateX(250px);
  background: url(data:image/png;base64,${art}) center / cover; }
.fade { position: absolute; inset: 0; background: linear-gradient(90deg, #070c1f 0%, rgba(7,12,31,.92) 34%, rgba(7,12,31,0) 62%); }
.text { position: absolute; left: 84px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; gap: 22px;
  font-family: Q; color: #f2f7fb; }
.brand { display: flex; align-items: center; gap: 22px; }
.brand svg { width: 104px; height: 104px; }
.word { font-size: 118px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }
.tag { font-size: 40px; font-weight: 600; line-height: 1.2; color: #c9f6fb; max-width: 560px; }
.fine { font-size: 26px; font-weight: 500; color: #a3b3cc; max-width: 470px; line-height: 1.4; }
</style></head><body>
<div class="art"></div><div class="fade"></div>
<div class="text">
  <div class="brand">${cube}<span class="word">melty</span></div>
  <div class="tag">chat rooms that melt.</div>
  <div class="fine">end-to-end encrypted · no account · gone when the timer ends</div>
</div></body></html>`;

const browser = await chromium.launch(
  process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: process.env.BROWSER_CHANNEL ?? "msedge" },
);
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: web("public/brand/og.jpg"), type: "jpeg", quality: 86 });
  console.log("wrote web/public/brand/og.jpg");

  // icons: plain (cube on transparent) and maskable (cube inside the 80% safe zone, on night blue)
  mkdirSync(web("public/icons"), { recursive: true });
  for (const [name, size, maskable] of [
    ["icon-192.png", 192, false],
    ["icon-512.png", 512, false],
    ["icon-maskable-512.png", 512, true],
  ]) {
    const p = await browser.newPage({ viewport: { width: size, height: size } });
    const pad = maskable ? size * 0.22 : size * 0.04;
    await p.setContent(`<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;
      background:${maskable ? "radial-gradient(circle at 50% 45%, #16305c, #0a1024 70%)" : "transparent"}">
      <div style="width:${size - 2 * pad}px;height:${size - 2 * pad}px">${cube.replace("<svg ", '<svg width="100%" height="100%" ')}</div></body></html>`);
    await p.screenshot({ path: web(`public/icons/${name}`), omitBackground: !maskable });
    await p.close();
    console.log(`wrote web/public/icons/${name}`);
  }
} finally {
  await browser.close();
}
