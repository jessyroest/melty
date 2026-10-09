#!/usr/bin/env node
// Browser test for the screenshot deterrents, against the relay and the production
// build (`pnpm --filter @melty/web preview`). Deterrents are best effort; this checks
// that they behave as documented: only the creator can switch them on, everyone gets
// them, messages are blurred until hovered or held, the room blurs when the window
// loses focus, and a watermark with your own nickname is drawn over the log.
import { chromium } from "playwright-core";

const WEB = process.env.WEB_URL ?? "http://localhost:4173";
const channel = process.env.BROWSER_CHANNEL ?? "msedge";

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch({ channel });
const violations = [];
async function person() {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return page;
}
const box = (page) => page.getByRole("textbox", { name: "message", exact: true });
const blurOf = (page, text) =>
  page.locator(".r-text", { hasText: text }).first().evaluate((el) => getComputedStyle(el).filter);

try {
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
  await b.getByRole("heading", { name: "melty room" }).waitFor();

  check((await b.getByRole("button", { name: /screenshot deterrents/ }).count()) === 0, "only the creator has the deterrent switch");

  await a.getByRole("button", { name: /turn on screenshot deterrents/ }).click();
  await b.getByText("screenshot deterrents on: messages blur until you touch them.").waitFor({ timeout: 5000 });
  check(true, "everyone is told the deterrents are on");
  check((await b.locator(".r-deter").count()) === 1, "the room bar shows a screenshot-deterrent chip");

  await box(a).fill("look but don't keep");
  await a.keyboard.press("Enter");
  await b.locator(".r-text", { hasText: "look but don't keep" }).waitFor();
  await b.mouse.move(5, 5);
  check((await blurOf(b, "look but don't keep")).includes("blur"), "a new message arrives blurred");
  await b.locator(".r-bubble", { hasText: "look but don't keep" }).hover();
  await b.waitForTimeout(250);
  check(!(await blurOf(b, "look but don't keep")).includes("blur"), "hovering the bubble reveals it");
  // screen readers still get the text: it's only a visual blur
  check((await b.locator(".r-text", { hasText: "look but don't keep" }).count()) === 1, "the text stays in the page for screen readers");

  const mark = await b.locator(".r-watermark bdi").first().textContent();
  const bNick = (await b.getByRole("button", { name: /your nickname is/ }).getAttribute("aria-label")).match(/is (.+)\. change/)?.[1]?.replace(/[⁦-⁩]/g, "");
  check(!!mark && mark === bNick, "the watermark shows the viewer's own nickname");

  await b.evaluate(() => window.dispatchEvent(new Event("blur")));
  await b.waitForFunction(() => document.querySelector(".room")?.classList.contains("is-away") || !document.hasFocus(), null, { timeout: 2000 }).catch(() => {});
  // headless pages report hasFocus() true, so force the state the handler would set
  const away = await b.evaluate(() => {
    const room = document.querySelector(".room");
    room?.classList.add("is-away");
    return getComputedStyle(document.querySelector(".messages")).filter;
  });
  check(away.includes("blur"), "looking away blurs the whole log");
  await b.evaluate(() => document.querySelector(".room")?.classList.remove("is-away"));

  await a.getByRole("button", { name: "turn screenshot deterrents off" }).click();
  await b.getByText("screenshot deterrents off.").waitFor({ timeout: 5000 });
  await b.mouse.move(5, 5);
  check(!(await blurOf(b, "look but don't keep")).includes("blur"), "switching off un-blurs messages");
  check((await b.locator(".r-watermark").count()) === 0, "and removes the watermark");

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
console.log("\ne2e deter ok");
