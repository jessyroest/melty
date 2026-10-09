#!/usr/bin/env node
// End-to-end smoke test in a real browser (local Edge/Chrome via playwright-core).
// Needs the relay (`pnpm --filter @melty/relay dev`) and the built app
// served with production headers (`pnpm --filter @melty/web preview`).
//
// Checks: two people can talk through the relay; the fragment leaves the
// address bar; nothing lands in web storage or cookies; no request leaves our
// origin + relay; no CSP violations; leaving wipes the room.
import { chromium } from "playwright-core";

const WEB = process.env.WEB_URL ?? "http://localhost:4173";
const RELAY = new URL(process.env.VITE_RELAY_URL ?? "ws://localhost:8787").origin;
const SHOTS = process.env.SHOTS_DIR;
const channel = process.env.BROWSER_CHANNEL ?? "msedge";

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

// BROWSER_PATH: a Chromium binary instead of an installed channel (e.g. in a container)
const browser = await chromium.launch(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel });
const requests = [];
const violations = [];

async function person() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("request", (r) => requests.push(r.url()));
  page.on("websocket", (ws) => requests.push(ws.url()));
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return { ctx, page };
}

async function storageIsEmpty(page) {
  return page.evaluate(async () => {
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    return localStorage.length === 0 && sessionStorage.length === 0 && document.cookie === "" && dbs.length === 0;
  });
}

try {
  const a = await person();
  await a.page.goto(WEB);
  await a.page.getByLabel("10 min").check();
  await a.page.locator("#start").getByRole("button", { name: "open a room" }).click();
  const dialog = a.page.getByRole("dialog");
  await dialog.waitFor();
  const link = await dialog.getByRole("textbox", { name: "room link" }).inputValue();
  check(/\/r#[A-Za-z0-9_-]{43}$/.test(link), "creator gets a /r#<43-char secret> link");
  check(new URL(a.page.url()).hash === "", "creator's address bar never shows the secret");
  check(await dialog.getByRole("img", { name: /QR code/ }).isVisible(), "QR code is shown");
  check(await dialog.getByText("anyone with this link gets in while someone's inside").isVisible(), "share warning is shown");
  const words = await dialog.getByRole("list", { name: "or say these 4 words" }).getByRole("listitem").allTextContents();
  check(words.length === 4, "the share sheet shows the room's 4 words");
  if (SHOTS) await a.page.screenshot({ path: `${SHOTS}/share.png` });
  await dialog.getByRole("button", { name: "close" }).click();

  const b = await person();
  await b.page.goto(link);
  await b.page.getByText("it's quiet. say hi.").waitFor();
  check(new URL(b.page.url()).hash === "" && new URL(b.page.url()).pathname === "/r", "joiner's fragment is stripped from the address bar");
  await a.page.getByText(/joined$/).waitFor();
  check(true, "creator sees the (encrypted) join notice");
  check((await a.page.getByText("2 of 8 here").count()) === 1, "presence count updates to 2");

  await b.page.getByRole("textbox", { name: "message", exact: true }).fill("hello from b");
  await b.page.keyboard.press("Enter");
  await a.page.getByText("hello from b").waitFor({ timeout: 5000 });
  check(true, "message from b arrives at a");

  await a.page.getByRole("textbox", { name: "message", exact: true }).fill("hi b, this melts");
  await a.page.getByRole("button", { name: "send" }).click();
  await b.page.getByText("hi b, this melts").waitFor({ timeout: 5000 });
  check(true, "message from a arrives at b");

  await b.page.getByRole("button", { name: /your nickname is/ }).click();
  await b.page.getByRole("textbox", { name: "your nickname" }).fill("tester");
  await b.page.getByRole("button", { name: "save" }).click();
  await a.page.getByText(/ is now tester$/).waitFor({ timeout: 5000 });
  check(true, "nickname change reaches the other side");

  check(await storageIsEmpty(a.page), "creator: no localStorage/sessionStorage/cookies/IndexedDB");
  // the PWA's service worker caches the app's own static files, and nothing else
  const cached = await a.page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const urls = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) urls.push(r.url);
    return urls;
  });
  const staticPath = /^\/(index\.html|sw\.js|favicon\.svg|manifest\.webmanifest|assets\/[\w.-]+|brand\/[\w.-]+)$/;
  check(
    cached.length > 0 && cached.every((u) => new URL(u).origin === new URL(WEB).origin && staticPath.test(new URL(u).pathname) && !u.includes("#")),
    `the service worker cached only static app files (${cached.length})`,
  );
  check(await storageIsEmpty(b.page), "joiner: no localStorage/sessionStorage/cookies/IndexedDB");
  if (SHOTS) await a.page.screenshot({ path: `${SHOTS}/chat-a.png` });

  await b.page.getByRole("button", { name: "leave" }).click();
  await b.page.getByText("you left. nothing was kept.").waitFor();
  check(new URL(b.page.url()).pathname === "/", "leaving returns to the start screen");
  await a.page.getByText("tester left").waitFor({ timeout: 5000 });
  check(true, "the other side sees the leave notice");

  await b.page.goto(`${WEB}/r`);
  await b.page.getByText("nothing here").waitFor();
  check(true, "opening /r without a key shows nothing (keys gone)");

  const c = await person();
  await c.page.goto(`${WEB}/r#${"A".repeat(43)}`);
  await c.page.getByText("that room doesn't exist, or it already melted.").waitFor({ timeout: 5000 });
  check(true, "a link to a room that doesn't exist is refused");

  await c.page.goto(`${WEB}/how`);
  await c.page.getByRole("heading", { name: "does not protect against" }).waitFor();
  if (SHOTS) await c.page.screenshot({ path: `${SHOTS}/how.png`, fullPage: true });
  await c.page.goto(WEB);
  if (SHOTS) await c.page.screenshot({ path: `${SHOTS}/home.png` });

  const foreign = requests.filter((u) => {
    const url = new URL(u);
    // the Vite dev server's own hot-reload socket only exists in dev
    if (url.protocol === "ws:" && url.host === new URL(WEB).host && url.searchParams.has("token")) return false;
    return url.origin !== new URL(WEB).origin && url.origin !== RELAY;
  });
  check(foreign.length === 0, `no requests outside ${new URL(WEB).origin} and ${RELAY}${foreign.length ? `: ${foreign.join(", ")}` : ""}`);
  check(violations.length === 0, `no CSP violations${violations.length ? `: ${violations.join(" | ")}` : ""}`);
} catch (e) {
  failures.push(String(e));
  console.log(`FAIL ${e}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\ne2e smoke ok");
