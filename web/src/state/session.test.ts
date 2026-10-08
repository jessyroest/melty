import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { open, seal, type Sealed } from "../crypto/aead";
import { deriveRoom, newSecret, type RoomKeys } from "../crypto/derive";
import { decodeInner, encodeInner, type Inner } from "../crypto/message";
import { toB64url } from "../lib/b64url";

// A stand-in for the relay socket: records what the session sends, lets the test play the relay.
const h = vi.hoisted(() => {
  type Ev = Record<string, unknown> & { type: string };
  class FakeRelay {
    static all: FakeRelay[] = [];
    open = true;
    closed = false;
    sent: { iv: string; ct: string }[] = [];
    raw: string[] = [];
    constructor(
      public roomId: string,
      public create: number | undefined,
      public owner: string | undefined,
      public onEvent: (e: Ev) => void,
    ) {
      FakeRelay.all.push(this);
    }
    send(s: { iv: string; ct: string }): boolean {
      if (!this.open) return false;
      this.sent.push(s);
      return true;
    }
    sendRaw(f: string): boolean {
      if (!this.open) return false;
      this.raw.push(f);
      return true;
    }
    control(): boolean {
      return this.open;
    }
    close(): void {
      this.closed = true;
      this.open = false;
    }
  }
  return { FakeRelay };
});
vi.mock("../net/relay", () => ({ RelayConnection: h.FakeRelay }));
vi.mock("../lib/router", () => ({ navigate: vi.fn() }));

const { createRoom, getStore, joinFromFragment, retryRoom, wake, wipeNow } = await import("./session");
const { FIRST_TRIES, OFFLINE_CAP_MS } = await import("./resilience");

type Fake = InstanceType<typeof h.FakeRelay>;
type Priv = {
  secret: Uint8Array | null;
  keys: RoomKeys | null;
  owner: { secret: Uint8Array } | null;
  leaveFrame: string | null;
  tickTimer: unknown;
  retryTimer: unknown;
  conn: unknown;
};

const last = (): Fake => h.FakeRelay.all[h.FakeRelay.all.length - 1]!;
const session = () => getStore().session!;
const priv = () => session() as unknown as Priv;
const settle = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function hello(c: Fake, over: Partial<{ now: number; expiresAt: number; ttl: number }> = {}): void {
  const now = over.now ?? Date.now();
  c.onEvent({ type: "hello", now, expiresAt: over.expiresAt ?? now + 600_000, ttl: over.ttl ?? 600, n: 2, locked: false });
}

async function decrypt(keys: RoomKeys, s: Sealed): Promise<Inner | null> {
  return decodeInner(await open(keys.key, keys.aad, s));
}

async function join(): Promise<{ keys: RoomKeys; c: Fake }> {
  const secret = newSecret();
  const keys = await deriveRoom(secret.slice());
  expect(await joinFromFragment(toB64url(secret))).toBe(true);
  return { keys, c: last() };
}

beforeEach(() => {
  h.FakeRelay.all.length = 0;
});
afterEach(() => {
  wipeNow();
  vi.useRealTimers();
});

describe("pagehide wipe", () => {
  it("is synchronous: goodbye sent, secret zeroed, keys dropped, lines gone, all in the same tick", async () => {
    const { keys, c } = await join();
    hello(c);
    await settle();
    expect(priv().leaveFrame).toEqual(expect.any(String));

    const chat: Inner = { v: 1, kind: "chat", id: "AAAAAAAAAAA", nick: "otter", text: "psst", ts: Date.now() };
    c.onEvent({ type: "msg", sealed: await seal(keys.key, keys.aad, encodeInner(chat)) });
    await settle();
    const s = session();
    expect(s.view.lines.map((l) => l.text)).toEqual(["psst"]);

    const secret = priv().secret!;
    const internals = priv();
    expect(secret.some((b) => b !== 0)).toBe(true);

    // no await between the call and the checks
    const ret: unknown = wipeNow();
    expect(ret).toBeUndefined();
    expect(c.raw).toHaveLength(1);
    expect(secret.every((b) => b === 0)).toBe(true);
    expect(internals.secret).toBeNull();
    expect(internals.keys).toBeNull();
    expect(internals.owner).toBeNull();
    expect(internals.leaveFrame).toBeNull();
    expect(internals.tickTimer).toBeUndefined();
    expect(internals.retryTimer).toBeUndefined();
    expect(internals.conn).toBeNull();
    expect(s.view.lines).toEqual([]);
    expect(s.view.typing).toEqual([]);
    expect(c.closed).toBe(true);
    expect(getStore()).toMatchObject({ session: null, view: null, notice: null, error: null });

    // and what went out really is our encrypted goodbye
    const frame = JSON.parse(c.raw[0]!) as { t: string; iv: string; ct: string };
    expect(frame.t).toBe("msg");
    expect(await decrypt(keys, frame)).toMatchObject({ kind: "leave" });
  });

  it("zeroes the creator's owner secret too", async () => {
    await createRoom(600);
    const c = last();
    expect(c.create).toBe(600);
    hello(c);
    await settle();
    const owner = priv().owner!.secret;
    expect(owner.some((b) => b !== 0)).toBe(true);
    wipeNow();
    expect(owner.every((b) => b === 0)).toBe(true);
  });

  it("still wipes when the socket is already closed, and sends nothing", async () => {
    const { c } = await join();
    hello(c);
    await settle();
    c.open = false;
    const secret = priv().secret!;
    wipeNow();
    expect(c.raw).toEqual([]);
    expect(secret.every((b) => b === 0)).toBe(true);
    expect(getStore().session).toBeNull();
  });

  it("re-seals the goodbye after a nick change", async () => {
    const { keys, c } = await join();
    hello(c);
    await settle();
    await session().setNick("new-name");
    await settle();
    wipeNow();
    const frame = JSON.parse(c.raw[0]!) as Sealed;
    expect(await decrypt(keys, frame)).toMatchObject({ kind: "leave", nick: "new-name" });
  });
});

describe("reconnect", () => {
  it("keeps the key, reconnects, and never repeats the join notice", async () => {
    await createRoom(600);
    const { keys } = { keys: priv().keys! };
    const c1 = last();
    hello(c1);
    await settle();
    c1.onEvent({ type: "closed", code: 1006 });
    await flush();
    expect(session().view.status).toBe("reconnecting");
    expect(priv().secret).not.toBeNull();

    await settle(600); // first retry is at most 500 ms
    const c2 = last();
    expect(c2).not.toBe(c1);
    expect(c2.create).toBeUndefined(); // the room exists now: rejoin, don't create
    hello(c2);
    await settle();
    expect(session().view.status).toBe("live");

    const kinds = await Promise.all([...c1.sent, ...c2.sent].map(async (s) => (await decrypt(keys, s))?.kind));
    expect(kinds.filter((k) => k === "join")).toHaveLength(1);
  });

  it("tells the others about a rename made while offline, once back", async () => {
    const { keys, c } = await join();
    hello(c);
    await settle();
    const before = session().view.nick;
    c.open = false;
    c.onEvent({ type: "closed", code: 1006 });
    await flush();
    await session().setNick("renamed");
    wake("online"); // retry right away
    const c2 = last();
    expect(c2).not.toBe(c);
    hello(c2);
    await settle();
    const msgs = await Promise.all(c2.sent.map((s) => decrypt(keys, s)));
    expect(msgs).toEqual([expect.objectContaining({ kind: "nick", nick: "renamed", prev: before })]);
  });

  it("before the first hello: a few tries, then 'unreachable' with the key kept; try again works", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    await join();
    for (let i = 0; i <= FIRST_TRIES; i++) {
      last().onEvent({ type: "unreachable" });
      await flush();
      vi.advanceTimersByTime(10_000);
    }
    expect(h.FakeRelay.all).toHaveLength(FIRST_TRIES + 1);
    expect(getStore().error).toBe("unreachable");
    expect(getStore().session).not.toBeNull();
    expect(priv().secret).not.toBeNull();

    retryRoom();
    expect(getStore().error).toBeNull();
    expect(h.FakeRelay.all).toHaveLength(FIRST_TRIES + 2);
    hello(last());
    await flush();
    expect(session().view.status).toBe("live");
  });

  it("gives up after the offline cap and wipes the key ('lost')", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    const { c } = await join();
    hello(c, { expiresAt: Date.now() + 24 * 3600_000, ttl: 86400 });
    await flush();
    const secret = priv().secret!;
    c.onEvent({ type: "closed", code: 1006 });
    await flush();
    let seen = 1;
    for (let t = 0; t <= OFFLINE_CAP_MS + 20_000 && getStore().session; t += 5000) {
      vi.advanceTimersByTime(5000);
      while (seen < h.FakeRelay.all.length) {
        h.FakeRelay.all[seen++]!.onEvent({ type: "unreachable" });
        await flush();
      }
    }
    expect(getStore()).toMatchObject({ session: null, error: "lost" });
    expect(secret.every((b) => b === 0)).toBe(true);
    // backoff stays capped: roughly one try per 5–10 s, not a storm
    expect(h.FakeRelay.all.length).toBeLessThan(OFFLINE_CAP_MS / 5000 + 10);
    expect(h.FakeRelay.all.length).toBeGreaterThan(OFFLINE_CAP_MS / 10_000 - 5);
  });

  it("ends as 'expired' when the room runs out while offline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    const { c } = await join();
    hello(c, { expiresAt: Date.now() + 20_000 });
    await flush();
    c.onEvent({ type: "closed", code: 1006 });
    await flush();
    let seen = 1;
    for (let t = 0; t < 40_000 && getStore().session; t += 1000) {
      vi.advanceTimersByTime(1000);
      while (seen < h.FakeRelay.all.length) {
        h.FakeRelay.all[seen++]!.onEvent({ type: "unreachable" });
        await flush();
      }
    }
    expect(getStore()).toMatchObject({ session: null, error: "expired" });
  });
});

describe("server clock", () => {
  it("ignores device clock jumps and keeps view.offset meaningful", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    const { c } = await join();
    const server = Date.now() + 90_000; // the device clock is 90 s behind the server
    hello(c, { now: server, expiresAt: server + 600_000 });
    await flush();
    expect(session().serverNow()).toBe(server);
    expect(session().view.offset).toBe(90_000);

    vi.setSystemTime(Date.now() + 3600_000); // someone sets the clock an hour ahead
    vi.advanceTimersByTime(5000);
    expect(session().serverNow()).toBe(server + 5000);
    expect(Date.now() + session().view.offset).toBe(server + 5000);
    expect(getStore().session).not.toBeNull(); // and the room didn't melt early
  });
});

describe("error mapping", () => {
  it.each([
    ["not_found", "not_found", "that room doesn't exist, or it already melted."],
    ["gone", "expired", "that room already melted."],
    ["full", "full", "that room is full. 8 people max."],
    ["locked", "locked", "that room is locked. ask someone inside to unlock it."],
    ["limit", "limit", "too many new rooms from your network. try again in a while."],
    ["slow", "slow", "too many connection attempts from your network."],
  ] as const)("relay error %s → %s screen, key wiped", async (code, kind, notice) => {
    const { c } = await join();
    const secret = priv().secret!;
    c.onEvent({ type: "error", code });
    expect(getStore()).toMatchObject({ session: null, error: kind, notice });
    expect(secret.every((b) => b === 0)).toBe(true);
  });

  it("melted by the creator → 'melted' for the others, plain notice for the creator", async () => {
    const { c } = await join();
    hello(c);
    c.onEvent({ type: "melted" });
    expect(getStore().error).toBe("melted");

    await createRoom(600);
    hello(last());
    last().onEvent({ type: "melted" });
    expect(getStore().error).toBeNull();
    expect(getStore().notice).toBe("that room melted. everything's gone.");
  });

  it("expiry → 'expired'", async () => {
    const { c } = await join();
    hello(c);
    c.onEvent({ type: "expired" });
    expect(getStore().error).toBe("expired");
  });
});

describe("client-side rate budget", () => {
  it("refuses a message up front instead of letting the relay drop it silently", async () => {
    const { c } = await join();
    hello(c);
    await settle();
    const before = c.sent.length;
    const results: boolean[] = [];
    for (let i = 0; i < 8; i++) results.push(await session().send(`msg ${i}`));
    // the join notice already spent one token; the rest of the burst goes through, then refusals
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(5);
    expect(results.at(-1)).toBe(false);
    expect(c.sent.length - before).toBe(results.filter(Boolean).length);
    expect(getStore().view?.hint).toMatch(/still in the box/);
    // nothing refused shows up as a sent bubble
    expect(getStore().view?.lines.filter((l) => l.mine && l.kind === "chat").length).toBe(results.filter(Boolean).length);
  });

  it("typing notices never use the last tokens a message needs", async () => {
    const { c } = await join();
    hello(c);
    await settle();
    for (let i = 0; i < 4; i++) await session().send(`m${i}`);
    const before = c.sent.length;
    session().typing();
    await settle();
    expect(c.sent.length).toBe(before);
  });

  it("marks the last own message as not delivered when the relay says rate", async () => {
    const { c } = await join();
    hello(c);
    await settle();
    await session().send("hello");
    c.onEvent({ type: "error", code: "rate" });
    const mine = getStore().view?.lines.filter((l) => l.mine && l.kind === "chat") ?? [];
    expect(mine.at(-1)?.undelivered).toBe(true);
  });
});
