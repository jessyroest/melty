#!/usr/bin/env node
// Resilience e2e in a real browser (local Edge/Chrome via playwright-core).
// Needs the relay and the app (dev server or preview), like e2e-smoke.mjs.
//
// Checks:
//  1. a joiner goes offline for ~20 s: the room shows "reconnecting…", typing is
//     refused with a hint, and once back online the room recovers by itself,
//     messages flow both ways and the join notice is not repeated
//  2. a link to a room that doesn't exist shows the not-found screen
//  3. a locked room refuses a newcomer with the locked screen
//  4. a relay that can't be reached shows the unreachable screen with the key kept,
//     and the tab gets in by itself once the network is back
import { chromium } from "playwright-core";

const WEB = process.env.WEB_URL ?? "http://localhost:4173";
const SHOTS = process.env.SHOTS_DIR;
const OFFLINE_MS = Number(process.env.OFFLINE_MS ?? 20_000);
const channel = process.env.BROWSER_CHANNEL ?? "msedge";

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

// BROWSER_PATH: a Chromium binary instead of an installed channel (e.g. in a container)
const browser = await chromium.launch(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel });
const violations = [];

async function person() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return { ctx, page };
}

const msgBox = (p) => p.getByRole("textbox", { name: "message", exact: true });
async function say(p, text) {
  await msgBox(p).fill(text);
  await p.keyboard.press("Enter");
}

try {
  // ---- set up a room with two people ----------------------------------------------
  const a = await person();
  await a.page.goto(WEB);
  await a.page.getByLabel("10 min").check();
  await a.page.locator("#start").getByRole("button", { name: "open a room" }).click();
  const sheet = a.page.getByRole("dialog");
  await sheet.waitFor();
  const link = await sheet.getByRole("textbox", { name: "room link" }).inputValue();
  await sheet.getByRole("button", { name: "close" }).click();

  const b = await person();
  await b.page.goto(link);
  await b.page.getByText("it's quiet. say hi.").waitFor();
  await a.page.getByText(/joined$/).waitFor();

  // ---- 1. offline for a while, then back ------------------------------------------
  await b.ctx.setOffline(true);
  await b.page.getByText("reconnecting…").waitFor({ timeout: 5000 });
  check(true, "going offline shows reconnecting…");
  await say(b.page, "typed while offline");
  await b.page.waitForTimeout(300);
  check(
    (await msgBox(b.page).inputValue()) === "typed while offline" && (await b.page.locator(".r-pool").getByText("typed while offline").count()) === 0,
    "a message typed offline is not sent; the draft stays in the box",
  );
  await b.page.waitForTimeout(OFFLINE_MS);
  check(new URL(b.page.url()).pathname === "/r", `after ${OFFLINE_MS / 1000}s offline the joiner is still in the room`);
  check((await b.page.getByText("reconnecting…").count()) === 1, "still showing reconnecting… while offline");
  if (SHOTS) await b.page.screenshot({ path: `${SHOTS}/resilience-offline.png` });

  const back = Date.now();
  await b.ctx.setOffline(false);
  await b.page.locator(".r-status--live").waitFor({ state: "attached", timeout: 8000 });
  check(true, `back online: live again after ${((Date.now() - back) / 1000).toFixed(1)}s`);

  await say(b.page, "back from the tunnel");
  await a.page.getByText("back from the tunnel").waitFor({ timeout: 5000 });
  check(true, "after the reconnect b's message reaches a");
  await say(a.page, "welcome back");
  await b.page.getByText("welcome back").waitFor({ timeout: 5000 });
  check(true, "and a's message reaches b");
  check((await a.page.getByText(/ joined$/).count()) === 1, "no duplicate join notice after the reconnect");
  check((await a.page.locator(".r-pool").getByText("typed while offline").count()) === 0, "nothing typed offline leaks through later");

  // ---- 2. not found ---------------------------------------------------------------
  const c = await person();
  await c.page.goto(`${WEB}/r#${"A".repeat(43)}`);
  await c.page.getByRole("heading", { name: "no room here" }).waitFor({ timeout: 8000 });
  check(await c.page.getByText("that room doesn't exist, or it already melted.").isVisible(), "not-found link shows the not-found screen");
  check(await c.page.getByText("the room key is gone from this tab.").isVisible(), "the not-found screen says the key is gone");
  if (SHOTS) await c.page.screenshot({ path: `${SHOTS}/resilience-not-found.png` });
  await c.page.getByRole("button", { name: "open a new room" }).click();
  await c.page.locator("#start").waitFor();
  check(new URL(c.page.url()).pathname === "/", "'open a new room' goes back to the start panel");

  // ---- 3. locked ------------------------------------------------------------------
  await a.page.getByRole("button", { name: "lock the room: nobody new can join" }).click();
  await b.page.getByText("the room is locked. nobody new can join.").waitFor({ timeout: 5000 });
  await c.page.goto(link);
  await c.page.getByRole("heading", { name: "the door is closed" }).waitFor({ timeout: 8000 });
  check(await c.page.getByText("that room is locked. ask someone inside to unlock it.").isVisible(), "a locked room shows the locked screen to a newcomer");
  check(new URL(c.page.url()).hash === "", "the locked screen leaves no fragment in the address bar");
  if (SHOTS) await c.page.screenshot({ path: `${SHOTS}/resilience-locked.png` });
  await a.page.getByRole("button", { name: "unlock the room" }).click();
  await b.page.getByText("the room is open again.").waitFor({ timeout: 5000 });

  // ---- 4. relay unreachable, then reachable ---------------------------------------
  const d = await person();
  await d.page.goto(WEB);
  await d.ctx.setOffline(true);
  // open the link in this already-loaded tab (a full page load can't happen offline)
  await d.page.evaluate((frag) => {
    history.pushState(null, "", "/r");
    location.hash = frag;
  }, new URL(link).hash.slice(1));
  await d.page.getByRole("heading", { name: "can't reach the relay" }).waitFor({ timeout: 15000 });
  check(true, "an unreachable relay gets its own screen");
  check(await d.page.getByText("is still only in its memory.", { exact: false }).isVisible(), "the unreachable screen says the link is still in memory");
  check(await d.page.getByRole("button", { name: "try again" }).isVisible(), "it offers try again");
  if (SHOTS) await d.page.screenshot({ path: `${SHOTS}/resilience-unreachable.png` });
  await d.ctx.setOffline(false);
  await d.page.locator(".r-status--live").waitFor({ state: "attached", timeout: 10000 });
  check(true, "back online, the tab gets into the room by itself with the kept key");
  await a.page.getByText(/ joined$/).nth(1).waitFor({ timeout: 5000 });
  check(true, "and the others see it join");

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
console.log("\ne2e resilience ok");
