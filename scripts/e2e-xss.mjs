#!/usr/bin/env node
// Browser test: hostile message text and nicknames render as plain text.
// Two people in a real room (relay + web app). b sends XSS payloads, bidi
// tricks, zalgo, a wall of emoji and a long unbroken string; a must show each
// one literally, never run anything, never create markup from it, and keep
// the layout intact at phone width.
//
// Runs against the production preview by default (WEB_URL=http://localhost:4173); set WEB_URL=http://localhost:5173 for the dev server.
import { chromium } from "playwright-core";

const WEB = process.env.WEB_URL ?? "http://localhost:4173";
const SHOTS = process.env.SHOTS_DIR;
const channel = process.env.BROWSER_CHANNEL ?? "msedge";

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const RLO = "‮";
const PDF = "‬";
const zalgo = (() => {
  let s = "";
  let k = 0;
  for (const ch of "zalgo is here") {
    s += ch;
    if (ch !== " ") for (let i = 0; i < 18; i++) s += String.fromCharCode(0x300 + ((k++ * 7) % 0x70));
  }
  return s;
})();
// close to the 4 KB message limit, with multi-codepoint sequences mixed in
const emojiWall = (() => {
  const set = ["🧊", "💧", "🔥", "👍🏽", "👨‍👩‍👧‍👦", "🏳️‍🌈", "🫠", "🇳🇱"];
  let s = "";
  for (let i = 0; ; i++) {
    const next = s + set[i % set.length];
    if (Buffer.byteLength(next) > 3850) return s;
    s = next;
  }
})();

const PAYLOADS = [
  ["img onerror", "<img src=x onerror=alert(1)>"],
  ["script tag", "<script>alert(1)</script>"],
  ["svg onload", '"><svg onload=alert(1)>'],
  ["javascript: url", "javascript:alert(1)"],
  ["right-to-left override", `invoice ${RLO}fdp.exe${PDF} ok`],
  ["zalgo", zalgo],
  [`${Buffer.byteLength(emojiWall)} bytes of emoji`, emojiWall],
  ["300 chars, no spaces", "x".repeat(150) + "W".repeat(150)],
];
const NICK = `<b>x</b>${RLO}evil`;

// BROWSER_PATH: a Chromium binary instead of an installed channel (e.g. in a container)
const browser = await chromium.launch(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel });
const dialogs = [];
const violations = [];

async function person() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return page;
}
const box = (page) => page.getByRole("textbox", { name: "message", exact: true });

/** no markup was created from user text inside the message log */
async function logIsClean(page) {
  return page.evaluate(() => {
    const log = document.querySelector('[role="log"]');
    if (!log) return "no log";
    const bad = [
      ...log.querySelectorAll("img, script, iframe, object, embed, a[href^='javascript']"),
      ...[...log.querySelectorAll("*")].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))),
      ...[...log.querySelectorAll("b")].filter((el) => el.textContent === "x"),
      ...[...log.querySelectorAll("svg")].filter((el) => el.closest(".r-text")),
    ];
    return bad.length ? bad.map((el) => el.outerHTML.slice(0, 80)).join(" | ") : "";
  });
}

async function layout(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const log = document.querySelector('[role="log"]').getBoundingClientRect();
    const out = [];
    for (const b of document.querySelectorAll(".r-bubble")) {
      const r = b.getBoundingClientRect();
      if (r.left < log.left - 1 || r.right > log.right + 1) out.push(`${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    return { overflow: doc.scrollWidth - doc.clientWidth, outside: out, logW: Math.round(log.width) };
  });
}

try {
  const a = await person();
  await a.goto(WEB);
  await a.getByLabel("10 min").check();
  await a.locator("#start").getByRole("button", { name: "open a room" }).click();
  const sheet = a.getByRole("dialog");
  await sheet.waitFor();
  const link = await sheet.getByRole("textbox", { name: "room link" }).inputValue();
  await sheet.getByRole("button", { name: "close" }).click();
  await sheet.waitFor({ state: "hidden" });

  const b = await person();
  await b.goto(link);
  await a.getByText(/joined$/).first().waitFor();

  // a hostile nickname: markup stays text, the bidi override is stripped or isolated
  await b.getByRole("button", { name: /your nickname is/ }).click();
  await b.getByRole("textbox", { name: "your nickname" }).fill(NICK);
  await b.getByRole("button", { name: "save nickname" }).click();
  const renamed = a.locator(".r-sys", { hasText: "<b>x</b>" });
  await renamed.waitFor({ timeout: 5000 });
  check(true, "a nickname with <b>x</b> shows up literally in the notice");
  const nickBidi = await renamed.evaluate((el) =>
    [...el.querySelectorAll("bdi")].every((n) => getComputedStyle(n).unicodeBidi.includes("isolate")),
  );
  check(nickBidi, "nicknames in notices are bidi-isolated");

  for (const [name, text] of PAYLOADS) {
    await box(b).fill(text);
    const over = await b.locator(".r-bytes--over").count();
    if (over) {
      check(false, `${name}: payload fits in one message`);
      continue;
    }
    await b.keyboard.press("Enter");
    // match on the exact text content: a prefix filter is flaky for zalgo, whose
    // combining marks Playwright's text matching may normalise or reorder
    const arrived = await a
      .waitForFunction((t) => [...document.querySelectorAll(".r-text")].some((el) => el.textContent === t), text, {
        timeout: 5000,
      })
      .then(() => true)
      .catch(() => false);
    check(arrived, `${name}: arrives and renders literally`);
    await a.waitForTimeout(250); // stay under the relay's per-connection rate limit
  }

  // the nickname is shown on a's side as a text-only, isolated group header
  const header = a.locator(".r-msgs__nick").last();
  check((await header.evaluate((el) => el.textContent)).startsWith("<b>x</b>"), "the nickname header is literal text");
  check(
    await header.evaluate((el) => el.tagName === "BDI" && getComputedStyle(el).unicodeBidi.includes("isolate")),
    "the nickname header is bidi-isolated",
  );
  const rtlIsolated = await a
    .locator(".r-text", { hasText: "invoice" })
    .evaluate((el) => el.tagName === "BDI" && getComputedStyle(el).unicodeBidi.includes("isolate"));
  check(rtlIsolated, "message text is bidi-isolated, so an override can't flip the bubble around it");

  for (const [who, page] of [
    ["receiver", a],
    ["sender", b],
  ]) {
    const dirty = await logIsClean(page);
    check(dirty === "", `${who}: no img/script/svg/handler elements created in the message log${dirty ? `: ${dirty}` : ""}`);
    const l = await layout(page);
    check(l.overflow <= 0, `${who}: no horizontal overflow at 390px (${l.overflow}px)`);
    check(l.outside.length === 0, `${who}: every bubble stays inside the log (${l.logW}px)${l.outside.length ? `: ${l.outside.join(", ")}` : ""}`);
  }
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/xss-a.png` });

  // the emoji wall and zalgo must not make the page wider either, even scrolled to them
  await a.locator(".r-text", { hasText: zalgo.slice(0, 6) }).first().scrollIntoViewIfNeeded();
  check((await layout(a)).overflow <= 0, "receiver: still no horizontal overflow next to the zalgo text");

  check(dialogs.length === 0, `no dialog ever opened${dialogs.length ? `: ${dialogs.join(" | ")}` : ""}`);
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
console.log("\ne2e xss ok");
