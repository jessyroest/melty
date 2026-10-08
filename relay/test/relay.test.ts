import { runDurableObjectAlarm } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLOSE, CREATE_LIMIT_PER_HOUR, inferTtl, MAX_CT_CHARS, MAX_FRAME_CHARS, MAX_PARTICIPANTS } from "../src/protocol";
import { connect, fakeMsg, makeOwner, randomRoomId, rawFetch, roomStub, setStored, storageKeys, tick } from "./helpers";

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
    expect((await rawFetch(id, { path: "/" })).status).toBe(404);
    expect(await storageKeys(id)).toEqual([]);
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
