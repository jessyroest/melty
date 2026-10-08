import { runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOSE,
  CONNECT_BURST,
  CONNECT_PER_MIN,
  CREATE_LIMIT_PER_HOUR,
  inferTtl,
  MAX_CT_CHARS,
  MAX_FRAME_CHARS,
  MAX_PARTICIPANTS,
  RATE_BURST,
  ROOM_BURST,
  SUBPROTOCOL,
} from "../src/protocol";
import {
  type Conn,
  connect,
  fakeMsg,
  makeOwner,
  offer,
  randomRoomId,
  rawFetch,
  roomStub,
  setStored,
  storageKeys,
  tick,
} from "./helpers";

describe("rooms", () => {
  it("creating a room says hello with server time and expiry", async () => {
    const before = Date.now();
    const a = await connect(randomRoomId(), { create: 600 });
    const hello = await a.next();
    expect(hello.t).toBe("hello");
    if (hello.t !== "hello") return;
    expect(hello.n).toBe(1);
    expect(hello.expiresAt - hello.now).toBe(600_000);
    expect(hello.ttl).toBe(600);
    expect(hello.now).toBeGreaterThanOrEqual(before);
  });

  it("joining a room that doesn't exist is refused and creates nothing", async () => {
    const id = randomRoomId();
    const b = await connect(id);
    expect(await b.next()).toEqual({ t: "error", code: "not_found" });
    expect((await b.closed).code).toBe(CLOSE.not_found);
    expect(await storageKeys(id)).toEqual([]);
  });

  it("rejects ttl values outside the allowed set", async () => {
    const a = await connect(randomRoomId(), { create: 999 });
    expect(await a.next()).toEqual({ t: "error", code: "bad" });
  });

  it("tells joiners the room's total lifetime", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 3600 });
    await a.next();
    const b = await connect(id);
    expect(await b.next()).toMatchObject({ t: "hello", ttl: 3600 });
  });
});

describe("inferTtl", () => {
  it("picks the smallest option that fits the remaining time", () => {
    expect(inferTtl(5 * 60_000)).toBe(600);
    expect(inferTtl(30 * 60_000)).toBe(3600);
    expect(inferTtl(5 * 3600_000)).toBe(86400);
  });
});

describe("relaying", () => {
  it("forwards ciphertext to the others, not back to the sender, and stores nothing", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 600 });
    await a.next(); // hello
    const b = await connect(id);
    expect((await b.next()).t).toBe("hello");
    expect(await a.next()).toEqual({ t: "presence", n: 2 });

    for (let i = 0; i < 3; i++) b.send(fakeMsg());
    for (let i = 0; i < 3; i++) expect(await a.next()).toEqual(fakeMsg());
    await tick();
    expect(b.queue).toEqual([]);

    expect(await storageKeys(id)).toEqual(["expiresAt"]);
  });

  it("strips anything but iv and ct before forwarding", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 600 });
    await a.next();
    const b = await connect(id);
    await b.next();
    await a.next();
    b.send({ ...fakeMsg(), nick: "plain", extra: { x: 1 } });
    expect(await a.next()).toEqual(fakeMsg());
  });

  it("refuses malformed frames", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 600 });
    await a.next();
    a.send("not json");
    expect(await a.next()).toEqual({ t: "error", code: "bad" });
    a.send({ t: "msg", iv: "short", ct: "B".repeat(40) });
    expect(await a.next()).toEqual({ t: "error", code: "bad" });
  });

  it("tells the remaining people when someone leaves", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 600 });
    await a.next();
    const b = await connect(id);
    await b.next();
    await a.next();
    b.ws.close(1000);
    expect(await a.next()).toEqual({ t: "presence", n: 1 });
  });
});

describe("expiry", () => {
  it("closes everyone, wipes state and refuses the id afterwards", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 600 });
    await a.next();
    const b = await connect(id);
    await b.next();
    await a.next();

    await setStored(id, "expiresAt", Date.now() - 1);
    expect(await runDurableObjectAlarm(roomStub(id))).toBe(true);

    expect(await a.next()).toEqual({ t: "expired" });
    expect(await b.next()).toEqual({ t: "expired" });
    expect((await a.closed).code).toBe(CLOSE.expired);
    expect((await b.closed).code).toBe(CLOSE.expired);
    expect(await storageKeys(id)).toEqual(["goneUntil"]);

    for (const create of [undefined, 600]) {
      const c = await connect(id, { create });
      expect(await c.next()).toEqual({ t: "error", code: "gone" });
      expect((await c.closed).code).toBe(CLOSE.gone);
    }
  });

  it("drops the tombstone after the margin and keeps nothing at all", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 600 });
    await a.next();
    await setStored(id, "expiresAt", Date.now() - 1);
    await runDurableObjectAlarm(roomStub(id));
    await setStored(id, "goneUntil", Date.now() - 1);
    await runDurableObjectAlarm(roomStub(id));
    expect(await storageKeys(id)).toEqual([]);
  });

  it("a late message to an expired room expires it on the spot", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 600 });
    await a.next();
    await setStored(id, "expiresAt", Date.now() - 1);
    const join = await connect(id);
    expect(await join.next()).toEqual({ t: "error", code: "gone" });
    expect(await a.next()).toEqual({ t: "expired" });
  });
});

describe("limits", () => {
  it(`allows ${MAX_PARTICIPANTS} participants and refuses the next`, async () => {
    const id = randomRoomId();
    const conns = [await connect(id, { create: 600 })];
    for (let i = 1; i < MAX_PARTICIPANTS; i++) conns.push(await connect(id));
    for (const c of conns) expect((await c.next()).t).toBe("hello");
    const extra = await connect(id);
    expect(await extra.next()).toEqual({ t: "error", code: "full" });
    expect((await extra.closed).code).toBe(CLOSE.full);
  });

  it("refuses messages over the size limit without forwarding them", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 600 });
    await a.next();
    const b = await connect(id);
    await b.next();
    await a.next();

    b.send(fakeMsg(MAX_CT_CHARS));
    expect(await a.next()).toEqual(fakeMsg(MAX_CT_CHARS));

    b.send(fakeMsg(MAX_CT_CHARS + 4));
    expect(await b.next()).toEqual({ t: "error", code: "too_big" });
    b.send("x".repeat(MAX_FRAME_CHARS + 1));
    expect(await b.next()).toEqual({ t: "error", code: "too_big" });
    await tick();
    expect(a.queue).toEqual([]);
  });

  it("rate-limits a flooding connection", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 600 });
    await a.next();
    const b = await connect(id);
    await b.next();
    await a.next();

    for (let i = 0; i < 20; i++) b.send(fakeMsg());
    await tick(200);
    const forwarded = a.queue.filter((f) => f.t === "msg").length;
    const limited = b.queue.filter((f) => f.t === "error" && f.code === "rate").length;
    expect(forwarded + limited).toBe(20);
    expect(limited).toBeGreaterThan(0);
    expect(forwarded).toBeLessThanOrEqual(8);
  });

  it(`limits room creation to ${CREATE_LIMIT_PER_HOUR} per address per hour`, async () => {
    for (let i = 0; i < CREATE_LIMIT_PER_HOUR; i++) {
      const c = await connect(randomRoomId(), { create: 600, ip: "203.0.113.7" });
      expect((await c.next()).t).toBe("hello");
    }
    const over = await connect(randomRoomId(), { create: 600, ip: "203.0.113.7" });
    expect(await over.next()).toEqual({ t: "error", code: "limit" });
    expect((await over.closed).code).toBe(CLOSE.limit);

    const other = await connect(randomRoomId(), { create: 600, ip: "203.0.113.8" });
    expect((await other.next()).t).toBe("hello");
  });
});

describe("creator controls", () => {
  async function roomWithTwo() {
    const id = randomRoomId();
    const owner = await makeOwner();
    const a = await connect(id, { create: 600, owner: owner.hash });
    expect(await a.next()).toMatchObject({ t: "hello", locked: false });
    const b = await connect(id);
    await b.next();
    await a.next(); // presence
    return { id, owner, a, b };
  }

  it("the creator can melt the room for everyone, right now", async () => {
    const { id, owner, a, b } = await roomWithTwo();
    a.send({ t: "melt", owner: owner.secret });
    expect(await a.next()).toEqual({ t: "melted" });
    expect(await b.next()).toEqual({ t: "melted" });
    expect((await a.closed).code).toBe(CLOSE.melted);
    expect((await b.closed).code).toBe(CLOSE.melted);
    expect(await storageKeys(id)).toEqual(["goneUntil"]);
    const late = await connect(id);
    expect(await late.next()).toEqual({ t: "error", code: "gone" });
  });

  it("nobody else can melt or lock: a wrong or replayed-hash proof is refused", async () => {
    const { id, owner, a, b } = await roomWithTwo();
    const other = await makeOwner();
    b.send({ t: "melt", owner: other.secret });
    expect(await b.next()).toEqual({ t: "error", code: "bad" });
    // the hash itself is not the proof
    b.send({ t: "melt", owner: owner.hash });
    expect(await b.next()).toEqual({ t: "error", code: "bad" });
    b.send({ t: "lock", owner: other.secret, on: true });
    expect(await b.next()).toEqual({ t: "error", code: "bad" });
    await tick();
    expect(a.queue).toEqual([]);
    expect(await storageKeys(id)).toEqual(["expiresAt"]);
  });

  it("a locked room refuses newcomers until it's unlocked; the creator can always get back in", async () => {
    const { id, owner, a, b } = await roomWithTwo();
    a.send({ t: "lock", owner: owner.secret, on: true });
    expect(await a.next()).toEqual({ t: "locked", on: true });
    expect(await b.next()).toEqual({ t: "locked", on: true });

    const c = await connect(id);
    expect(await c.next()).toEqual({ t: "error", code: "locked" });
    expect((await c.closed).code).toBe(CLOSE.locked);

    const back = await connect(id, { owner: owner.hash });
    expect(await back.next()).toMatchObject({ t: "hello", locked: true });
    back.ws.close(1000);
    await a.next(); // presence 3
    await a.next(); // presence 2

    a.send({ t: "lock", owner: owner.secret, on: false });
    expect(await a.next()).toEqual({ t: "locked", on: false });
    const d = await connect(id);
    expect(await d.next()).toMatchObject({ t: "hello", locked: false });
  });

  it("owner and lock live only on the sockets, never in storage", async () => {
    const { id, owner, a, b } = await roomWithTwo();
    a.send({ t: "lock", owner: owner.secret, on: true });
    await a.next();
    await b.next();
    expect(await storageKeys(id)).toEqual(["expiresAt"]);
  });

  it("joining an empty room can't claim ownership", async () => {
    const id = randomRoomId();
    const owner = await makeOwner();
    const a = await connect(id, { create: 600, owner: owner.hash });
    await a.next();
    a.ws.close(1000);
    await tick(100);
    const thief = await makeOwner();
    const t = await connect(id, { owner: thief.hash });
    expect((await t.next()).t).toBe("hello");
    t.send({ t: "melt", owner: thief.secret });
    expect(await t.next()).toEqual({ t: "error", code: "bad" });
  });

  it("rejects a malformed owner parameter", async () => {
    const a = await connect(randomRoomId(), { create: 600, owner: "not-a-hash" });
    expect(await a.next()).toEqual({ t: "error", code: "bad" });
  });
});

describe("rejections", () => {
  it("a refused socket doesn't disturb the people in the room", async () => {
    const id = randomRoomId();
    const conns = [await connect(id, { create: 600 })];
    for (let i = 1; i < MAX_PARTICIPANTS; i++) conns.push(await connect(id));
    for (const c of conns) await c.next();
    await tick(100);
    for (const c of conns) c.queue.length = 0;
    const extra = await connect(id);
    expect(await extra.next()).toEqual({ t: "error", code: "full" });
    await extra.closed;
    await tick(100);
    for (const c of conns) expect(c.queue).toEqual([]);
  });

  it("ignores a reject header sent by the client", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 600, headers: { "X-Relay-Reject": "gone" } });
    expect((await a.next()).t).toBe("hello");
  });
});

describe("worker routing", () => {
  it("refuses unknown origins, plain http and other paths", async () => {
    const id = randomRoomId();
    expect((await rawFetch(id, { create: 600, origin: "https://evil.example" })).status).toBe(403);
    expect((await rawFetch(id, { create: 600, origin: null })).status).toBe(403);
    expect((await rawFetch(id, { upgrade: false })).status).toBe(426);
    expect((await rawFetch(id, { path: "/rooms/short/ws" })).status).toBe(404);
    expect((await rawFetch(id, { path: "/ws/" })).status).toBe(404);
    expect((await rawFetch(id, { path: "/" })).status).toBe(404);
    expect(await storageKeys(id)).toEqual([]);
  });
});

describe("transport: everything in Sec-WebSocket-Protocol, nothing in the URL", () => {
  it("the 101 selects exactly melty.v1, for accepted and refused sockets alike", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 600 });
    expect(a.res.status).toBe(101);
    expect(a.res.headers.get("Sec-WebSocket-Protocol")).toBe(SUBPROTOCOL);
    expect((await a.next()).t).toBe("hello");

    const missing = await connect(randomRoomId());
    expect(missing.res.headers.get("Sec-WebSocket-Protocol")).toBe(SUBPROTOCOL);
    expect(await missing.next()).toEqual({ t: "error", code: "not_found" });

    const bad = await connect(randomRoomId(), { create: 999 });
    expect(bad.res.headers.get("Sec-WebSocket-Protocol")).toBe(SUBPROTOCOL);
    expect(await bad.next()).toEqual({ t: "error", code: "bad" });
  });

  it("creates and joins a room through the fixed path /ws, with no room id, ttl or owner in the URL", async () => {
    const id = randomRoomId();
    const owner = await makeOwner();
    // rawFetch's URL is exactly https://relay.test/ws: no path segment, no query
    const a = await connect(id, { create: 3600, owner: owner.hash });
    expect(await a.next()).toMatchObject({ t: "hello", ttl: 3600, n: 1 });
    const b = await connect(id);
    expect(await b.next()).toMatchObject({ t: "hello", ttl: 3600, n: 2 });
    // the room object is keyed by the id from the header, and owner rights came through it
    expect(await storageKeys(id)).toEqual(["expiresAt"]);
    expect(await a.next()).toEqual({ t: "presence", n: 2 });
    a.send({ t: "lock", owner: owner.secret, on: true });
    expect(await a.next()).toEqual({ t: "locked", on: true });
  });

  it("refuses the old URL scheme and any query string, so nothing about a room can ride in the URL", async () => {
    const id = randomRoomId();
    expect((await rawFetch(id, { path: `/rooms/${id}/ws?create=600`, protocol: null })).status).toBe(404);
    expect((await rawFetch(id, { path: `/rooms/${id}/ws`, create: 600 })).status).toBe(404);
    expect((await rawFetch(id, { path: "/ws?create=600", create: 600 })).status).toBe(400);
    expect((await rawFetch(id, { path: `/ws?r=${id}`, create: 600 })).status).toBe(400);
    expect(await storageKeys(id)).toEqual([]);
  });

  it("refuses a missing or unusable offer with a plain 400", async () => {
    const id = randomRoomId();
    const cases: (string | null)[] = [
      null,
      "",
      `r.${id}, c.600`, // melty.v1 not offered
      `melty.v2, r.${id}, c.600`,
      `${SUBPROTOCOL}, ${SUBPROTOCOL}, r.${id}, c.600`,
      `${SUBPROTOCOL}, c.600`, // no room id
      `${SUBPROTOCOL}, r.${id.slice(1)}, c.600`,
      `${SUBPROTOCOL}, r.${id}x, c.600`,
      `${SUBPROTOCOL}, r.${id.slice(1)}+, c.600`,
      `${SUBPROTOCOL}, r.${id}, r.${randomRoomId()}, c.600`,
      `${SUBPROTOCOL}, R.${id}, c.600`,
      `${SUBPROTOCOL}, r.${id}, c.600, ${"x".repeat(300)}`,
    ];
    for (const protocol of cases) {
      const res = await rawFetch(id, { protocol });
      expect(res.status, String(protocol)).toBe(400);
      expect(res.webSocket, String(protocol)).toBeNull();
    }
    expect(await storageKeys(id)).toEqual([]);
  });

  it("refuses malformed parts next to a valid room id with error bad, creating nothing", async () => {
    const id = randomRoomId();
    const owner = await makeOwner();
    const cases = [
      `${SUBPROTOCOL}, r.${id}, c.999`,
      `${SUBPROTOCOL}, r.${id}, c.`,
      `${SUBPROTOCOL}, r.${id}, c.0600`,
      `${SUBPROTOCOL}, r.${id}, c.6e2`,
      `${SUBPROTOCOL}, r.${id}, c.600, c.600`,
      `${SUBPROTOCOL}, r.${id}, c.600, o.not-a-hash`,
      `${SUBPROTOCOL}, r.${id}, c.600, o.${owner.hash}, o.${owner.hash}`,
      `${SUBPROTOCOL}, r.${id}, c.600, x.1`,
      `${SUBPROTOCOL}, r.${id}, , c.600`,
      `${SUBPROTOCOL}, r.${id}, c.600 o.${owner.hash}`,
    ];
    for (const protocol of cases) {
      const c = await connect(id, { protocol });
      expect(c.res.headers.get("Sec-WebSocket-Protocol")).toBe(SUBPROTOCOL);
      expect(await c.next(), protocol).toEqual({ t: "error", code: "bad" });
      expect((await c.closed).code).toBe(CLOSE.bad);
    }
    expect(await storageKeys(id)).toEqual([]);
    // the same parts, well-formed and in any order, work
    const ok = await connect(id, { protocol: `o.${owner.hash}, c.600,${SUBPROTOCOL},r.${id}` });
    expect((await ok.next()).t).toBe("hello");
  });

  it("ignores internal headers sent by the client", async () => {
    // a join can't create a room by forging the worker's create header
    const id = randomRoomId();
    const j = await connect(id, { headers: { "X-Relay-Create": "600" } });
    expect(await j.next()).toEqual({ t: "error", code: "not_found" });
    expect(await storageKeys(id)).toEqual([]);

    // nor register an owner the offer didn't carry, nor force a refusal
    const owner = await makeOwner();
    const id2 = randomRoomId();
    const a = await connect(id2, { create: 600, headers: { "X-Relay-Owner": owner.hash, "x-relay-reject": "full" } });
    expect((await a.next()).t).toBe("hello");
    a.send({ t: "melt", owner: owner.secret });
    expect(await a.next()).toEqual({ t: "error", code: "bad" });
    expect(await storageKeys(id2)).toEqual(["expiresAt"]);

    // nor bend the ttl past what the offer validated
    const c = await connect(randomRoomId(), { create: 600, headers: { "X-Relay-Create": "999999" } });
    expect(await c.next()).toMatchObject({ t: "hello", ttl: 600 });
  });

  it("the offer helper builds what the browser client sends", () => {
    expect(offer("ID", { create: 600, owner: "H" })).toBe(`${SUBPROTOCOL}, r.ID, c.600, o.H`);
  });
});

describe("per-address and per-room limits", () => {
  it(`allows ${CONNECT_BURST} connection attempts a minute per address, joins included; other addresses are unaffected`, async () => {
    // freeze the clock so the bucket can't refill while the attempts are in flight
    const t0 = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(t0);
    try {
      const ip = "192.0.2.44";
      const extra = 10;
      // joins to rooms that don't exist: still attempts, and they create nothing
      const conns = await Promise.all(Array.from({ length: CONNECT_BURST + extra }, () => connect(randomRoomId(), { ip })));
      const frames = await Promise.all(conns.map((c) => c.next()));
      const count = (code: string) => frames.filter((f) => f.t === "error" && f.code === code).length;
      expect(count("not_found")).toBe(CONNECT_BURST);
      expect(count("slow")).toBe(extra);
      const refused = conns[frames.findIndex((f) => f.t === "error" && f.code === "slow")]!;
      expect((await refused.closed).code).toBe(CLOSE.slow);

      // creating from that address is refused too, as "slow", and creates nothing
      const id = randomRoomId();
      const create = await connect(id, { create: 600, ip });
      expect(await create.next()).toEqual({ t: "error", code: "slow" });
      expect(await storageKeys(id)).toEqual([]);

      // a different address is fine
      const other = await connect(randomRoomId(), { create: 600, ip: "192.0.2.45" });
      expect((await other.next()).t).toBe("hello");

      // one second later the first address has earned exactly one more attempt
      clock.mockReturnValue(t0 + 60_000 / CONNECT_PER_MIN);
      const again = await connect(id, { create: 600, ip });
      expect((await again.next()).t).toBe("hello");
      const more = await connect(randomRoomId(), { ip });
      expect(await more.next()).toEqual({ t: "error", code: "slow" });
    } finally {
      clock.mockRestore();
    }
  });

  it("caps a room's total message rate even when every connection stays under its own limit", async () => {
    const id = randomRoomId();
    const listener = await connect(id, { create: 600 });
    await listener.next();
    const senders: Conn[] = [];
    for (let i = 1; i < MAX_PARTICIPANTS; i++) {
      const c = await connect(id);
      await c.next();
      senders.push(c);
    }
    await tick(100);
    listener.queue.length = 0;
    for (const s of senders) s.queue.length = 0;

    // 7 sockets x RATE_BURST messages: each within its own burst, 35 in total.
    // The clock is frozen so no bucket refills while the frames arrive.
    const t0 = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(t0);
    try {
      const total = senders.length * RATE_BURST;
      for (let i = 0; i < RATE_BURST; i++) for (const s of senders) s.send(fakeMsg());
      const count = () => ({
        forwarded: listener.queue.filter((f) => f.t === "msg").length,
        limited: senders.flatMap((s) => s.queue).filter((f) => f.t === "error" && f.code === "rate").length,
      });
      for (let waited = 0; waited < 3000 && count().forwarded + count().limited < total; waited += 50) await tick(50);
      await tick(100);
      const { forwarded, limited } = count();
      expect(forwarded).toBe(ROOM_BURST);
      expect(limited).toBe(total - ROOM_BURST);
      // nothing else went anywhere: senders saw only others' messages and their own rate errors
      for (const s of senders) expect(s.queue.every((f) => f.t === "msg" || (f.t === "error" && f.code === "rate"))).toBe(true);

      // a second later the budget has refilled; it lives in memory only
      clock.mockReturnValue(t0 + 1000);
      listener.queue.length = 0;
      senders[0]!.send(fakeMsg());
      expect(await listener.next()).toEqual(fakeMsg());
      expect(await storageKeys(id)).toEqual(["expiresAt"]);
    } finally {
      clock.mockRestore();
    }
  });
});

describe("logging", () => {
  const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
  let spies: ReturnType<typeof vi.spyOn>[] = [];
  beforeEach(() => {
    spies = methods.map((m) => vi.spyOn(console, m));
  });
  afterEach(() => spies.forEach((s) => s.mockRestore()));

  it("a full room lifecycle writes nothing to the console", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 600, ip: "198.51.100.1" });
    await a.next();
    const b = await connect(id, { ip: "198.51.100.2" });
    await b.next();
    await a.next();
    b.send(fakeMsg());
    await a.next();
    b.send("garbage");
    await b.next();
    await setStored(id, "expiresAt", Date.now() - 1);
    await runDurableObjectAlarm(roomStub(id));
    await a.closed;
    await connect(id);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
