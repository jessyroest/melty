#!/usr/bin/env node
// Browser test for the phase 3 features, against the relay and the production
// build (`pnpm --filter @melty/web preview`): encrypted typing indicator,
// reactions, burn-after-read, locking the room, and melting it early.
import { chromium } from "playwright-core";

const WEB = process.env.WEB_URL ?? "http://localhost:4173";
const SHOTS = process.env.SHOTS_DIR;
const channel = process.env.BROWSER_CHANNEL ?? "msedge";

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch({ channel });
const violations = [];

async function person() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return page;
}
const box = (page) => page.getByRole("textbox", { name: "message", exact: true });

try {
  // a opens a room, b joins
  const a = await person();
  await a.goto(WEB);
  await a.getByLabel("10 min").check();
  await a.locator("#start").getByRole("button", { name: "open a room" }).click();
  const sheet = a.getByRole("dialog");
  await sheet.waitFor();
  const link = await sheet.getByRole("textbox", { name: "room link" }).inputValue();
  await a.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden" });

  const b = await person();
  await b.goto(link);
  await a.getByText(/joined$/).first().waitFor();
  const bNick = (await a.getByText(/joined$/).first().textContent()).replace(/ joined$/, "").replace(/^[^a-z0-9]+/i, "");

  // 1. typing indicator (encrypted "typing" notices)
  await box(b).pressSequentially("hel", { delay: 40 });
  await a.getByText(`${bNick} is typing`).waitFor({ timeout: 5000 });
  check(true, "typing indicator shows up on the other side");
  await box(b).fill("hello a");
  await b.keyboard.press("Enter");
  await a.getByText("hello a").waitFor();
  await a.getByText(`${bNick} is typing`).waitFor({ state: "hidden", timeout: 5000 });
  check(true, "typing indicator clears when the message arrives");

  // 2. reactions
  await a.getByText("hello a").hover();
  await a.getByRole("button", { name: "react to this message" }).first().click();
  await a.getByRole("button", { name: "react with 🧊" }).click();
  await b.getByRole("button", { name: /^🧊 from / }).waitFor({ timeout: 5000 });
  check(true, "a reaction reaches the sender's bubble");
  await b.getByRole("button", { name: /^🧊 from / }).click();
  const chip = a.getByRole("button", { name: /^🧊 from / });
  await a.waitForFunction(() => document.querySelector(".r-react .r-react__n")?.textContent === "2", null, { timeout: 5000 });
  check((await chip.getAttribute("aria-pressed")) === "true", "both reactions counted, own reaction marked");

  // 3. burn after reading
  await a.getByRole("button", { name: "burn after reading" }).click();
  await box(a).fill("this melts");
  await a.keyboard.press("Enter");
  const thaw = b.getByRole("button", { name: /burn after reading\. tap to open/ });
  await thaw.waitFor({ timeout: 5000 });
  check((await b.getByText("this melts").count()) === 0, "burn message arrives frozen, text hidden");
  await thaw.click();
  await b.getByText("this melts").waitFor();
  check(true, "opening it shows the text");
  if (SHOTS) await b.screenshot({ path: `${SHOTS}/p3-burn-open.png` });
  await b.getByText("this melts").waitFor({ state: "detached", timeout: 15000 });
  check(true, "it melts away after 10 seconds for the reader");
  await a.getByText("this melts").waitFor({ state: "detached", timeout: 5000 });
  check(true, "and for the sender too");

  // 4. lock: a third person is refused, unlock lets them in
  await a.getByRole("button", { name: "lock the room: nobody new can join" }).click();
  await b.getByText("the room is locked. nobody new can join.").waitFor({ timeout: 5000 });
  check(true, "everyone sees the room get locked");
  const c = await person();
  await c.goto(link);
  await c.getByText("that room is locked. ask someone inside to unlock it.").waitFor({ timeout: 5000 });
  check(true, "a newcomer with the link is refused while locked");
  await a.getByRole("button", { name: "unlock the room" }).click();
  await b.getByText("the room is open again.").waitFor({ timeout: 5000 });
  await c.goto(link);
  await a.getByText(/joined$/).nth(1).waitFor({ timeout: 5000 });
  check(true, "after unlocking the newcomer gets in");
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/p3-room-a.png` });

  // 5. melt now: hold the button, everyone is out
  check((await b.getByRole("button", { name: /melt the room now/ }).count()) === 0, "only the creator has the melt button");
  const melt = a.getByRole("button", { name: /melt the room now/ });
  await melt.hover();
  await a.mouse.down();
  await a.waitForTimeout(600);
  await a.mouse.up();
  await a.waitForTimeout(400);
  check(new URL(a.url()).pathname === "/r", "a short press does nothing");
  await melt.hover();
  await a.mouse.down();
  await a.waitForTimeout(1800);
  await a.mouse.up();
  await b.waitForURL((u) => new URL(u).pathname === "/", { timeout: 5000 });
  await c.waitForURL((u) => new URL(u).pathname === "/", { timeout: 5000 });
  check(new URL(a.url()).pathname === "/", "holding melts the room: everyone is back on the start screen");
  await b.getByText("it's water now. nothing was kept.").waitFor({ timeout: 5000 });
  check(true, "the others are told it melted");
  const d = await person();
  await d.goto(link);
  await d.getByText("that room already melted.").waitFor({ timeout: 5000 });
  check(true, "the link is dead afterwards");

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
console.log("\ne2e features ok");
