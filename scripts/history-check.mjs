#!/usr/bin/env node
// Does the browser keep the room link's #fragment (the key) in its history, even
// though the app strips it with history.replaceState right away?
//
// For each browser channel (Edge, and Chrome if installed) this:
//  1. starts a fresh profile in a temp folder (launchPersistentContext)
//  2. creates a room in one tab and reads the link from the share sheet
//  3. opens that link in a second tab, the way a person pastes it in the address bar,
//     and in a third tab by clicking a link on a page, and waits until the app has
//     stripped the fragment
//  4. closes the browser, so history is written to disk
//  5. reads the profile's `History` SQLite database (a copy) with node:sqlite and
//     reports every URL that still has a `#`
//  6. as a wider check, searches every file in the profile for the secret itself
//
// It then repeats this in a second fresh profile where the link is never navigated to:
// the room is created in one tab and joined from another through the "join a room"
// dialog (pasting the link into the page). That shows whether the dialog keeps the key
// out of the profile, and that the creator's own tab never puts it there.
//
// Usage: WEB_URL=http://localhost:5173 node scripts/history-check.mjs
//        CHANNELS=msedge,chrome  HEADLESS=0 (headed)  KEEP_PROFILE=1 (don't delete it)
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";

const WEB = process.env.WEB_URL ?? "http://localhost:4173";
const CHANNELS = (process.env.CHANNELS ?? "msedge,chrome").split(",").map((c) => c.trim()).filter(Boolean);
const HEADLESS = process.env.HEADLESS !== "0";
const KEEP = process.env.KEEP_PROFILE === "1";

/** every file under dir, recursively */
function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...files(p));
    else if (st.isFile() && st.size < 64 * 1024 * 1024) out.push(p);
  }
  return out;
}

async function run(channel, mode) {
  const dir = mkdtempSync(join(tmpdir(), `melty-history-${channel}-${mode}-`));
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(dir, { channel, headless: HEADLESS, viewport: { width: 1200, height: 900 } });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    return { channel: `${channel} / ${mode}`, skipped: `can't launch: ${String(e).split("\n")[0]}` };
  }

  // 1. the creator's tab
  const a = ctx.pages()[0] ?? (await ctx.newPage());
  await a.goto(WEB);
  await a.getByLabel("10 min").check();
  await a.locator("#start").getByRole("button", { name: "open a room" }).click();
  const sheet = a.getByRole("dialog");
  await sheet.waitFor();
  const link = await sheet.getByRole("textbox", { name: "room link" }).inputValue();
  const secret = new URL(link).hash.slice(1);
  await sheet.getByRole("button", { name: "close" }).click();

  if (mode === "link") {
    // 2. pasted into the address bar
    const b = await ctx.newPage();
    await b.goto(link);
    await b.waitForFunction(() => location.hash === "" && location.pathname === "/r");
    await b.getByText("it's quiet. say hi.").waitFor();

    // 3. clicked from a page
    const c = await ctx.newPage();
    await c.goto(WEB);
    await c.evaluate((href) => {
      const el = document.createElement("a");
      el.href = href;
      el.id = "history-check-link";
      el.textContent = "room";
      document.body.append(el);
    }, link);
    await c.locator("#history-check-link").click();
    await c.waitForFunction(() => location.hash === "" && location.pathname === "/r");
    await c.getByText("it's quiet. say hi.").waitFor();
  } else {
    // 2'. never navigated to: pasted into the "join a room" dialog
    const b = await ctx.newPage();
    await b.goto(WEB);
    await b.getByRole("button", { name: "join a room" }).first().click();
    const dialog = b.getByRole("dialog");
    await dialog.getByRole("textbox").fill(link);
    await dialog.getByRole("textbox").press("Enter");
    await b.getByText("it's quiet. say hi.").waitFor();
  }

  // give the browser a moment to record the visits, then shut it down so it writes them out
  await a.waitForTimeout(1500);
  await ctx.close();

  const historyFile = join(dir, "Default", "History");
  if (!existsSync(historyFile)) {
    if (!KEEP) rmSync(dir, { recursive: true, force: true });
    return { channel: `${channel} / ${mode}`, error: "no Default/History file in the profile" };
  }
  const copy = join(dir, "History.copy.sqlite");
  copyFileSync(historyFile, copy);
  const db = new DatabaseSync(copy, { readOnly: true });
  const urls = db.prepare("SELECT url, title, visit_count, typed_count FROM urls ORDER BY id").all();
  db.close();

  const ours = urls.filter((u) => u.url.startsWith(new URL(WEB).origin));
  const withHash = urls.filter((u) => u.url.includes("#"));
  const withSecret = urls.filter((u) => u.url.includes(secret));

  // the wider check: is the secret anywhere in the profile, in any file?
  const needle = Buffer.from(secret, "utf8");
  const needle16 = Buffer.from(secret, "utf16le");
  const leaks = [];
  for (const f of files(dir)) {
    if (f === copy) continue;
    try {
      const buf = readFileSync(f);
      if (buf.includes(needle) || buf.includes(needle16)) leaks.push(f.slice(dir.length + 1));
    } catch {
      // locked or vanished
    }
  }

  if (!KEEP) rmSync(dir, { recursive: true, force: true });
  return { channel: `${channel} / ${mode}`, urls: urls.length, ours, withHash, withSecret, leaks, dir: KEEP ? dir : undefined };
}

const results = [];
const MODES = (process.env.MODES ?? "link,dialog").split(",");
for (const [channel, mode] of CHANNELS.flatMap((ch) => MODES.map((m) => [ch, m]))) {
  const how = mode === "link" ? "opening the link" : "pasting it into join a room";
  console.log(`\n== ${channel}, ${how}${HEADLESS ? " (headless)" : " (headed)"} ==`);
  const r = await run(channel, mode);
  results.push(r);
  if (r.skipped || r.error) {
    console.log(r.skipped ?? `ERROR ${r.error}`);
    continue;
  }
  console.log(`urls in History: ${r.urls} (${r.ours.length} on ${new URL(WEB).origin})`);
  for (const u of r.ours) console.log(`  ${u.url.replace(/#.+$/, "#<secret>")}  visits=${u.visit_count} typed=${u.typed_count}`);
  console.log(`urls with "#": ${r.withHash.length}${r.withSecret.length ? `, of which ${r.withSecret.length} contain the room secret` : ""}`);
  console.log(`profile files containing the secret: ${r.leaks.length ? r.leaks.join(", ") : "none"}`);
  if (r.dir) console.log(`profile kept at ${r.dir}`);
}

const measured = results.filter((r) => !r.skipped && !r.error);
if (!measured.length) {
  console.log("\nno browser could be measured");
  process.exit(2);
}
console.log("\nsummary:");
for (const r of results) {
  if (r.skipped || r.error) console.log(`  ${r.channel}: not measured (${r.skipped ?? r.error})`);
  else console.log(`  ${r.channel}: History keeps the fragment: ${r.withSecret.length ? "YES" : "no"}; secret elsewhere in profile: ${r.leaks.length ? r.leaks.join(", ") : "no"}`);
}
