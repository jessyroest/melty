import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sealed } from "../crypto/aead";
import { deriveLink, deriveRoom, newSecret, type RoomKeys } from "../crypto/derive";
import { newSenderId, openMsg, sealMsg } from "../crypto/frame";
import {
  decodeKx,
  encodeKx,
  hostAccept,
  hostKeys,
  joinerAnswer,
  type KxMsg,
  newHandshakeId,
  openBundle,
  safetyCode,
  sealBundle,
} from "../crypto/kx";
import { decodeInner, encodeInner, type Inner } from "../crypto/message";
import { codeWords, newDoorCode } from "../crypto/words";
import { type Bytes, toB64url } from "../lib/b64url";

// A stand-in for the relay socket: records what the session sends, lets the test play the relay.
const h = vi.hoisted(() => {
  type Ev = Record<string, unknown> & { type: string };
  type Target = { roomId?: string; create?: number; owner?: string; words?: string; knock?: string };
  class FakeRelay {
    static all: FakeRelay[] = [];
    open = true;
    closed = false;
    sent: { iv: string; ct: string }[] = [];
    raw: string[] = [];
    kx: { to: string | undefined; d: string }[] = [];
    roomId?: string;
    create?: number;
    owner?: string;
    words?: string;
    knock?: string;
    constructor(
      public target: Target,
      public onEvent: (e: Ev) => void,
    ) {
      Object.assign(this, target);
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
    sendKx(to: string | undefined, d: string): boolean {
      if (!this.open) return false;
      this.kx.push({ to, d });
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

const { createRoom, getStore, joinFromFragment, joinWithWords, KNOCK_WAIT_MS, retryRoom, wake, wipeNow } = await import(
  "./session"
);
const { FIRST_TRIES, OFFLINE_CAP_MS } = await import("./resilience");

type Fake = InstanceType<typeof h.FakeRelay>;
type Priv = {
  link: Uint8Array | null;
  roomKey: Uint8Array | null;
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
const HOST_TAG = "HHHHHHHHHHH";
const ME_TAG = "MMMMMMMMMMM";

function hello(c: Fake, over: Partial<{ now: number; expiresAt: number; ttl: number; n: number; lobby: boolean }> = {}): void {
  const now = over.now ?? Date.now();
  c.onEvent({
    type: "hello",
    now,
    expiresAt: over.expiresAt ?? now + 600_000,
    ttl: over.ttl ?? 600,
    n: over.n ?? 2,
    locked: false,
    tag: ME_TAG,
    lobby: over.lobby ?? false,
  });
}

async function decrypt(keys: RoomKeys, s: Sealed): Promise<Inner | null> {
  return decodeInner((await openMsg(keys.key, keys.aad, s)).plaintext);
}

/** the kx messages the session sent on this socket, decoded */
const kxSent = (c: Fake) => c.kx.map((k) => ({ to: k.to, m: decodeKx(k.d)! }));
const kxIn = (c: Fake, m: KxMsg, from = HOST_TAG) => c.onEvent({ type: "kx", from, d: encodeKx(m) });

/** a room someone else created: its link, raw key and keys */
async function room() {
  const link = newSecret();
  const roomKey = crypto.getRandomValues(new Uint8Array(32));
  const keys = await deriveRoom(link.slice(), roomKey.slice());
  return { link, roomKey, keys };
}

/** play the host's side of a link join: answer the session's req and hand over the key */
async function admit(c: Fake, r: { link: Bytes; roomKey: Bytes; keys: RoomKeys }, psk: Bytes = r.keys.psk) {
  await flush();
  const req = [...kxSent(c)].reverse().find((k) => k.m.k === "req")!.m as Extract<KxMsg, { k: "req" }>;
  expect(req.mode).toBe("link");
  const keys = hostKeys();
  kxIn(c, { k: "offer", hs: req.hs, x: keys.xPk, m: keys.mPk });
  const ans = [...kxSent(c)].reverse().find((k) => k.m.k === "ans")!;
  expect(ans.to).toBe(HOST_TAG);
  const res = hostAccept("link", req.hs, keys, ans.m as Extract<KxMsg, { k: "ans" }>, psk);
  if (!res) return null;
  kxIn(c, await sealBundle(res, req.hs, { key: r.roomKey, link: r.link, code: null, host: "host" }));
  await settle();
  return res;
}

async function joinRaw() {
  const r = await room();
  expect(await joinFromFragment(toB64url(r.link))).toBe(true);
  return { ...r, c: last() };
}

/** join by link, all the way in: hello, key exchange, live */
async function join(): Promise<{ keys: RoomKeys; c: Fake; link: Bytes }> {
  const r = await joinRaw();
  hello(r.c);
  expect(await admit(r.c, r)).not.toBeNull();
  expect(session().view.status).toBe("live");
  return { keys: r.keys, c: r.c, link: r.link };
}

const peer = newSenderId();
let peerCounter = 0;
const sealAs = (keys: RoomKeys, m: Inner, counter = peerCounter++) => sealMsg(keys.key, keys.aad, peer, counter, encodeInner(m));

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
    await settle();
    expect(priv().leaveFrame).toEqual(expect.any(String));

    const chat: Inner = { v: 1, kind: "chat", id: "AAAAAAAAAAA", nick: "otter", text: "psst", ts: Date.now() };
    c.onEvent({ type: "msg", sealed: await sealAs(keys, chat) });
    await settle();
    const s = session();
    expect(s.view.lines.map((l) => l.text)).toEqual(["psst"]);

    const secret = priv().link!;
    const roomKey = priv().roomKey!;
    const internals = priv();
    expect(secret.some((b) => b !== 0)).toBe(true);

    // no await between the call and the checks
    const ret: unknown = wipeNow();
    expect(ret).toBeUndefined();
    expect(c.raw).toHaveLength(1);
    expect(secret.every((b) => b === 0)).toBe(true);
    expect(roomKey.every((b) => b === 0)).toBe(true);
    expect(internals.link).toBeNull();
    expect(internals.roomKey).toBeNull();
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
    await settle();
    c.open = false;
    const secret = priv().link!;
    wipeNow();
    expect(c.raw).toEqual([]);
    expect(secret.every((b) => b === 0)).toBe(true);
    expect(getStore().session).toBeNull();
  });

  it("re-seals the goodbye after a nick change", async () => {
    const { keys, c } = await join();
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
    expect(priv().link).not.toBeNull();

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

  it("before the first hello: a few tries, then 'unreachable' with the link kept; try again works", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const r = await joinRaw();
    for (let i = 0; i <= FIRST_TRIES; i++) {
      last().onEvent({ type: "unreachable" });
      await flush();
      vi.advanceTimersByTime(10_000);
    }
    expect(h.FakeRelay.all).toHaveLength(FIRST_TRIES + 1);
    expect(getStore().error).toBe("unreachable");
    expect(getStore().session).not.toBeNull();
    expect(priv().link).not.toBeNull();

    retryRoom();
    expect(getStore().error).toBeNull();
    expect(h.FakeRelay.all).toHaveLength(FIRST_TRIES + 2);
    hello(last());
    await flush();
    expect(session().view.status).toBe("waiting");
    vi.useRealTimers();
    await admit(last(), r);
    expect(session().view.status).toBe("live");
  });

  it("gives up after the offline cap and wipes the key ('lost')", async () => {
    const { c } = await join();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
    hello(c, { expiresAt: Date.now() + 24 * 3600_000, ttl: 86400 });
    await flush();
    const secret = priv().link!;
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
    const { c } = await join();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
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
    const { c } = await join();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
    const server = Date.now() + 90_000; // the device clock is 90 s behind the server
    hello(c, { now: server, expiresAt: server + 600_000 });
    await flush();
    expect(session().serverNow()).toBe(server);
    expect(session().view.offset).toBe(90_000);

    vi.setSystemTime(Date.now() + 3600_000); // someone sets the clock an hour ahead
    vi.advanceTimersByTime(5000);
    expect(session().serverNow()).toBe(server + 5000);
    // the clock check runs on a tick and when the tab comes back into view
    wake("visible");
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
  ] as const)("relay error %s → %s screen, link wiped", async (code, kind, notice) => {
    const { c } = await joinRaw();
    const secret = priv().link!;
    c.onEvent({ type: "error", code });
    expect(getStore()).toMatchObject({ session: null, error: kind, notice });
    expect(secret.every((b) => b === 0)).toBe(true);
  });

  it("melted by the creator → 'melted' for the others, plain notice for the creator", async () => {
    const { c } = await join();
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
    c.onEvent({ type: "expired" });
    expect(getStore().error).toBe("expired");
  });
});

describe("client-side rate budget", () => {
  it("refuses a message up front instead of letting the relay drop it silently", async () => {
    const { c } = await join();
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
    await settle();
    for (let i = 0; i < 4; i++) await session().send(`m${i}`);
    const before = c.sent.length;
    session().typing();
    await settle();
    expect(c.sent.length).toBe(before);
  });

  it("marks the last own message as not delivered when the relay says rate", async () => {
    const { c } = await join();
    await settle();
    await session().send("hello");
    c.onEvent({ type: "error", code: "rate" });
    const mine = getStore().view?.lines.filter((l) => l.mine && l.kind === "chat") ?? [];
    expect(mine.at(-1)?.undelivered).toBe(true);
  });
});

describe("phase 2: joining with the link", () => {
  it("the link alone doesn't decrypt anything: the key comes through the exchange, early messages wait for it", async () => {
    const r = await joinRaw();
    hello(r.c);
    await flush();
    expect(session().view.status).toBe("waiting");
    expect(priv().keys).toBeNull();
    // a message that arrives before the key is kept, encrypted
    r.c.onEvent({ type: "msg", sealed: await sealAs(r.keys, { v: 1, kind: "chat", id: "AAAAAAAAAAB", nick: "otter", text: "early", ts: 1 }) });
    await settle();
    expect(session().view.lines).toEqual([]);
    await admit(r.c, r);
    expect(session().view.status).toBe("live");
    expect(session().view.lines.map((l) => l.text)).toEqual(["early"]);
    // and the join notice it sends is readable with the room key
    const kinds = await Promise.all(r.c.sent.map(async (s) => (await decrypt(r.keys, s))?.kind));
    expect(kinds).toContain("join");
  });

  it("a host without the link's psk (someone in the middle) can't hand over a key", async () => {
    const r = await joinRaw();
    hello(r.c);
    // the host side checks the MAC with the wrong psk: refused
    expect(await admit(r.c, r, crypto.getRandomValues(new Uint8Array(32)))).toBeNull();
    // and a bundle sealed without the psk doesn't open
    const req = [...kxSent(r.c)].reverse().find((k) => k.m.k === "req")!.m as Extract<KxMsg, { k: "req" }>;
    const fake = hostKeys();
    // a second offer for the same exchange is ignored: the first one won
    kxIn(r.c, { k: "offer", hs: req.hs, x: fake.xPk, m: fake.mPk }, "XXXXXXXXXXX");
    expect(kxSent(r.c).filter((k) => k.m.k === "ans")).toHaveLength(1);
    await settle();
    expect(priv().keys).toBeNull();
    expect(session().view.status).toBe("waiting");
  });

  it("asks again when nobody answers, then says nobody came, keeping the link for 'try again'", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const r = await joinRaw();
    hello(r.c);
    await flush();
    for (let i = 0; i < 3; i++) vi.advanceTimersByTime(8000);
    expect(kxSent(r.c).filter((k) => k.m.k === "req")).toHaveLength(3);
    expect(getStore().error).toBe("nobody");
    expect(priv().link).not.toBeNull();
    expect(r.c.closed).toBe(true);
    retryRoom();
    hello(last());
    expect(kxSent(last()).filter((k) => k.m.k === "req")).toHaveLength(1);
  });

  it("alone in the room: nobody can hand over the key", async () => {
    const r = await joinRaw();
    hello(r.c, { n: 1 });
    await flush();
    expect(getStore().error).toBe("nobody");
  });
});

describe("phase 2: hosting", () => {
  async function liveCreator() {
    await createRoom(600);
    const c = last();
    hello(c, { n: 1 });
    await settle();
    return c;
  }

  it("the creator registers the room's 4 words with the create", async () => {
    const c = await liveCreator();
    expect(c.create).toBe(600);
    expect(c.words).toMatch(/^\d{1,4}-\d{1,4}-\d{1,4}-\d{1,4}$/);
    expect(session().view.words).toHaveLength(4);
  });

  it("answers a link join at once and hands over the key only to someone with the link", async () => {
    const c = await liveCreator();
    const p = priv();
    const link = await deriveLink(p.link!.slice() as Bytes);
    const hs = newHandshakeId();
    kxIn(c, { k: "req", hs, mode: "link" }, "JJJJJJJJJJJ");
    await settle();
    const offer = kxSent(c).find((k) => k.m.k === "offer")!;
    expect(offer.to).toBe("JJJJJJJJJJJ");
    const o = offer.m as Extract<KxMsg, { k: "offer" }>;
    const j = joinerAnswer("link", hs, o, link.psk)!;
    kxIn(c, j.ans, "JJJJJJJJJJJ");
    await settle();
    const key = kxSent(c).find((k) => k.m.k === "key")!;
    expect(key.to).toBe("JJJJJJJJJJJ");
    const bundle = await openBundle(j.result, key.m as Extract<KxMsg, { k: "key" }>);
    expect(bundle.key).toEqual(p.roomKey);
    expect(bundle.link).toEqual(p.link);
    expect(codeWords(bundle.code!)).toEqual(session().view.words);
    // and it told the others it's handling this one (encrypted)
    const notes = await Promise.all(c.sent.map((s) => decrypt(p.keys!, s)));
    expect(notes).toContainEqual(expect.objectContaining({ kind: "door", hs: toB64url(hs), act: "in" }));
  });

  it("refuses a link join without the psk: no key goes out", async () => {
    const c = await liveCreator();
    const hs = newHandshakeId();
    kxIn(c, { k: "req", hs, mode: "link" }, "JJJJJJJJJJJ");
    await settle();
    const o = kxSent(c).find((k) => k.m.k === "offer")!.m as Extract<KxMsg, { k: "offer" }>;
    const j = joinerAnswer("link", hs, o, crypto.getRandomValues(new Uint8Array(32)))!;
    kxIn(c, j.ans, "JJJJJJJJJJJ");
    await settle();
    expect(kxSent(c).filter((k) => k.m.k === "key")).toEqual([]);
  });

  it("a knock with the words waits for a person: let in → exchange → same safety words on both sides", async () => {
    const c = await liveCreator();
    const hs = newHandshakeId();
    kxIn(c, { k: "req", hs, mode: "code" }, "KKKKKKKKKKK");
    await flush();
    expect(kxSent(c).filter((k) => k.m.k === "offer")).toEqual([]);
    expect(session().view.knocks).toEqual([{ hs: toB64url(hs), at: expect.any(Number) }]);

    session().letIn(toB64url(hs));
    expect(session().view.knocks).toEqual([]);
    const o = kxSent(c).find((k) => k.m.k === "offer")!.m as Extract<KxMsg, { k: "offer" }>;
    const j = joinerAnswer("code", hs, o, null)!;
    kxIn(c, j.ans, "KKKKKKKKKKK");
    await settle();
    const key = kxSent(c).find((k) => k.m.k === "key")!.m as Extract<KxMsg, { k: "key" }>;
    expect((await openBundle(j.result, key)).key).toEqual(priv().roomKey);
    const check = session().view.checks[0]!;
    expect(check).toMatchObject({ role: "host", state: "open", peer: null });
    expect(check.words).toEqual(safetyCode(j.result.th));

    // their join notice puts a name to it
    c.onEvent({ type: "msg", sealed: await sealAs(priv().keys!, { v: 1, kind: "join", nick: "newbie", ts: 1, hs: toB64url(hs) }) });
    await settle();
    expect(session().view.checks[0]!.peer).toBe("newbie");
    session().confirmCheck(toB64url(hs), true);
    expect(session().view.checks[0]!.state).toBe("match");
  });

  it("'not now' tells the knocker no", async () => {
    const c = await liveCreator();
    const hs = newHandshakeId();
    kxIn(c, { k: "req", hs, mode: "code" }, "KKKKKKKKKKK");
    await flush();
    session().turnAway(toB64url(hs));
    expect(kxSent(c).find((k) => k.m.k === "no")).toMatchObject({ to: "KKKKKKKKKKK" });
    expect(kxSent(c).filter((k) => k.m.k === "offer")).toEqual([]);
  });

  it("stands back when someone else inside already took the knock", async () => {
    const c = await liveCreator();
    const hs = newHandshakeId();
    kxIn(c, { k: "req", hs, mode: "code" }, "KKKKKKKKKKK");
    await flush();
    c.onEvent({
      type: "msg",
      sealed: await sealAs(priv().keys!, { v: 1, kind: "door", nick: "other", hs: toB64url(hs), act: "in", ts: 1 }),
    });
    await settle();
    expect(session().view.knocks).toEqual([]);
    session().letIn(toB64url(hs));
    expect(kxSent(c).filter((k) => k.m.k === "offer")).toEqual([]);
  });
});

describe("phase 2: joining with the words", () => {
  it("knocks, gets let in, moves from the lobby into the room, and shows the safety words", async () => {
    const r = await room();
    const code = newDoorCode();
    await joinWithWords(code);
    const lobby = last();
    expect(lobby.knock).toBe(code.join("-"));
    expect(lobby.roomId).toBeUndefined();
    hello(lobby, { lobby: true, n: 1 });
    await flush();
    expect(session().view.status).toBe("knocking");
    const req = kxSent(lobby)[0]!.m as Extract<KxMsg, { k: "req" }>;
    expect(req).toMatchObject({ k: "req", mode: "code" });
    expect(kxSent(lobby)[0]!.to).toBeUndefined();

    const keys = hostKeys();
    kxIn(lobby, { k: "offer", hs: req.hs, x: keys.xPk, m: keys.mPk });
    const ans = kxSent(lobby).find((k) => k.m.k === "ans")!.m as Extract<KxMsg, { k: "ans" }>;
    expect(ans.mac).toBeUndefined();
    const res = hostAccept("code", req.hs, keys, ans, null)!;
    kxIn(lobby, await sealBundle(res, req.hs, { key: r.roomKey, link: r.link, code, host: "the-host" }));
    await settle();

    // into the room proper, by room id
    expect(lobby.closed).toBe(true);
    const member = last();
    expect(member.roomId).toBe(r.keys.roomId);
    expect(member.create).toBeUndefined();
    expect(session().view.checks).toEqual([
      { hs: toB64url(req.hs), role: "joiner", peer: "the-host", words: safetyCode(res.th), state: "open" },
    ]);
    hello(member);
    await settle();
    expect(session().view.status).toBe("live");
    const msgs = await Promise.all(member.sent.map((s) => decrypt(r.keys, s)));
    expect(msgs).toContainEqual(expect.objectContaining({ kind: "join", hs: toB64url(req.hs) }));
    expect(priv().link).toEqual(r.link);
  });

  it("different safety words: the joiner leaves and everything is wiped", async () => {
    const r = await room();
    await joinWithWords(newDoorCode());
    const lobby = last();
    hello(lobby, { lobby: true });
    await flush();
    const req = kxSent(lobby)[0]!.m as Extract<KxMsg, { k: "req" }>;
    const keys = hostKeys();
    kxIn(lobby, { k: "offer", hs: req.hs, x: keys.xPk, m: keys.mPk });
    const ans = kxSent(lobby).find((k) => k.m.k === "ans")!.m as Extract<KxMsg, { k: "ans" }>;
    const res = hostAccept("code", req.hs, keys, ans, null)!;
    kxIn(lobby, await sealBundle(res, req.hs, { key: r.roomKey, link: r.link, code: null, host: "x" }));
    await settle();
    hello(last());
    await settle();
    const roomKey = priv().roomKey!;
    session().confirmCheck(toB64url(req.hs), false);
    expect(getStore()).toMatchObject({ session: null, error: "mismatch" });
    expect(roomKey.every((b) => b === 0)).toBe(true);
  });

  it("a 'no' ends the knock; silence ends it after the wait", async () => {
    await joinWithWords(newDoorCode());
    hello(last(), { lobby: true });
    await flush();
    const req = kxSent(last())[0]!.m as Extract<KxMsg, { k: "req" }>;
    kxIn(last(), { k: "no", hs: req.hs });
    expect(getStore().error).toBe("turned_away");

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    await joinWithWords(newDoorCode());
    hello(last(), { lobby: true });
    vi.advanceTimersByTime(KNOCK_WAIT_MS + 1);
    expect(getStore().error).toBe("nobody");
  });

  it("unknown words get their own sentence", async () => {
    await joinWithWords(newDoorCode());
    last().onEvent({ type: "error", code: "not_found" });
    expect(getStore()).toMatchObject({ error: "not_found", notice: expect.stringMatching(/words/) });
  });
});

describe("phase 2: replay protection", () => {
  it("drops a frame the relay plays a second time", async () => {
    const { keys, c } = await join();
    const sealed = await sealAs(keys, { v: 1, kind: "chat", id: "AAAAAAAAAAC", nick: "otter", text: "once", ts: 1 });
    c.onEvent({ type: "msg", sealed });
    c.onEvent({ type: "msg", sealed });
    await settle();
    expect(session().view.lines.filter((l) => l.text === "once")).toHaveLength(1);
  });

  it("our own frames carry an increasing counter", async () => {
    const { keys, c } = await join();
    await session().send("a");
    await session().send("b");
    const counters = await Promise.all(c.sent.map(async (s) => (await openMsg(keys.key, keys.aad, s)).counter));
    expect(counters).toEqual([...counters].sort((a, b) => a - b));
    expect(new Set(counters).size).toBe(counters.length);
  });
});
