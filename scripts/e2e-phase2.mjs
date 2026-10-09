#!/usr/bin/env node
// Browser test for phase 2, against the relay and the production build
// (`pnpm --filter @melty/web preview`):
//   - joining with the 4 words: knock, someone inside lets you in, both see the same 6 safety words
//   - joining with the link: the key comes through the key exchange, not the link
//   - anyone inside can hand over the key, not only the creator
//   - on the wire: only padded ciphertext sizes, no plaintext, key exchange frames in between
import { chromium } from "playwright-core";

const WEB = process.env.WEB_URL ?? "http://localhost:4173";
const SHOTS = process.env.SHOTS_DIR;
const channel = process.env.BROWSER_CHANNEL ?? "msedge";
// the only ciphertext lengths a padded message can have (see relay/src/protocol.ts)
const CT_CHARS = new Set([256, 1024, 4352].map((b) => Math.ceil(((12 + b + 16) * 4) / 3)));

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

// BROWSER_PATH: a Chromium binary instead of an installed channel (e.g. in a container)
const browser = await chromium.launch(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel });
const violations = [];
/** every frame the browsers sent to the relay */
const frames = [];

async function person(width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 860 } });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  page.on("websocket", (ws) => ws.on("framesent", (f) => frames.push(String(f.payload))));
  return page;
}
const box = (page) => page.getByRole("textbox", { name: "message", exact: true });

async function joinDialog(page, text) {
  await page.goto(WEB);
  await page.getByRole("button", { name: "join a room" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByRole("textbox", { name: "room link or 4 words" }).fill(text);
  await d.getByRole("button", { name: "join", exact: true }).click();
}

/** in the room with the key: the composer is there and enabled */
async function inside(page) {
  await page.waitForFunction(
    () => {
      // live: the placeholder says so (it reads "connecting…" until then)
      const t = document.querySelector("#msg");
      return t && !document.querySelector(".r-door-wait") && /won't last/.test(t.placeholder);
    },
    null,
    { timeout: 15000 },
  );
}

const safetyWords = (page) =>
  page.getByRole("list", { name: "safety words" }).first().getByRole("listitem").allTextContents();

try {
  // a opens a room and reads out its 4 words
  const a = await person();
  await a.goto(WEB);
  await a.getByLabel("10 min").check();
  await a.locator("#start").getByRole("button", { name: "open a room" }).click();
  const sheet = a.getByRole("dialog");
  await sheet.waitFor();
  const link = await sheet.getByRole("textbox", { name: "room link" }).inputValue();
  const words = await sheet.getByRole("list", { name: "or say these 4 words" }).getByRole("listitem").allTextContents();
  check(words.length === 4, `the room has 4 words: ${words.join(" ")}`);
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/share-words.png` });
  await a.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden" });

  // b knocks with the words (typed with dashes and capitals, the way people do)
  const b = await person(390);
  await joinDialog(b, words.join("-").toUpperCase());
  await b.getByRole("heading", { name: "knocking…" }).waitFor({ timeout: 8000 });
  check(true, "b is at the door, knocking");
  if (SHOTS) await b.screenshot({ path: `${SHOTS}/knocking.png` });

  await a.getByText("someone is knocking with the 4 words.").waitFor({ timeout: 8000 });
  check(true, "a sees the knock");
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/knock.png` });
  await a.getByRole("button", { name: "let in" }).click();

  await b.getByText("it's quiet. say hi.").or(b.getByText(/joined$/)).first().waitFor({ timeout: 10000 });
  const bWords = await safetyWords(b);
  await a.getByRole("list", { name: "safety words" }).waitFor({ timeout: 8000 });
  const aWords = await safetyWords(a);
  check(bWords.length === 6 && bWords.join(" ") === aWords.join(" "), `both see the same 6 safety words: ${bWords.join(" ")}`);
  if (SHOTS) await b.screenshot({ path: `${SHOTS}/safety-b.png` });
  if (SHOTS) await a.screenshot({ path: `${SHOTS}/safety-a.png` });
  await a.getByText(/who you just let in/).waitFor();
  check(true, "a's safety card names the person once their join notice arrives");
  await b.getByRole("button", { name: "same words" }).click();
  await a.getByRole("button", { name: "same words" }).click();
  check((await b.getByRole("list", { name: "safety words" }).count()) === 0, "confirming the words puts the card away");

  await box(b).fill("hi, the words matched");
  await b.keyboard.press("Enter");
  await a.getByText("hi, the words matched").waitFor({ timeout: 5000 });
  check(true, "b (in through the words) can talk to a");

  // c joins with the link while a is inside: the key arrives through the exchange
  const c = await person();
  await c.goto(link);
  await inside(c);
  await box(c).fill("c here, came with the link");
  await c.keyboard.press("Enter");
  await a.getByText("c here, came with the link").waitFor({ timeout: 5000 });
  await b.getByText("c here, came with the link").waitFor({ timeout: 5000 });
  check(true, "c (link) got the key and talks to both");

  // a (the creator) leaves; d joins with the link and b or c hands over the key
  await a.getByRole("button", { name: "leave" }).click();
  await b.getByText(/ left$/).first().waitFor({ timeout: 5000 });
  const d = await person();
  await d.goto(link);
  await inside(d);
  await box(d).fill("d: let in by someone who isn't the creator");
  await d.keyboard.press("Enter");
  await b.getByText("d: let in by someone who isn't the creator").waitFor({ timeout: 5000 });
  check(true, "with the creator gone, another member hands over the key");

  // a wrong set of words is refused by the relay
  const e = await person();
  await joinDialog(e, "acid acorn acre acts");
  await e.getByText(/no room answers to those words|nobody let you in|that room/).first().waitFor({ timeout: 8000 });
  check(true, "words that don't belong to a room are refused");

  // on the wire
  const msgs = frames.map((f) => JSON.parse(f)).filter((f) => f.t === "msg");
  const kx = frames.map((f) => JSON.parse(f)).filter((f) => f.t === "kx");
  check(msgs.length > 5 && msgs.every((m) => CT_CHARS.has(m.ct.length)), `all ${msgs.length} messages are padded to the fixed sizes`);
  check(kx.length >= 6, `key exchange frames went over the relay (${kx.length})`);
  const plain = ["hi, the words matched", "c here, came with the link", ...words];
  check(!frames.some((f) => plain.some((p) => f.includes(p))), "no plaintext or words in any frame");
  check(violations.length === 0, `no CSP violations${violations.length ? `: ${violations.join(" | ")}` : ""}`);
} catch (err) {
  failures.push(String(err));
  console.log(`FAIL ${err}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\ne2e phase 2 ok");
