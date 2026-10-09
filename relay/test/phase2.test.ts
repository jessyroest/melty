import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { doorName } from "../src/door";
import { CLOSE, CT_CHARS, LOBBY_MS, MAX_KX_CHARS, MAX_LOBBY, WORDS_BURST } from "../src/protocol";
import { type Conn, connect, fakeMsg, knock, makeOwner, randomIp, randomRoomId, randomWords, roomStub, setStored, storageKeys, tick } from "./helpers";

const doorStub = (words: string) => env.DOOR.get(env.DOOR.idFromName(doorName(words)));

/** a room with words and its creator, hello consumed */
async function roomWithWords(opts: { owner?: string } = {}) {
  const id = randomRoomId();
  const words = randomWords();
  const a = await connect(id, { create: 600, words, ...opts });
  const hello = await a.next();
  expect(hello).toMatchObject({ t: "hello", n: 1 });
  return { id, words, a, tag: (hello as { tag: string }).tag };
}

async function hello(c: Conn) {
  const h = await c.next();
  if (h.t !== "hello") throw new Error(`expected hello, got ${JSON.stringify(h)}`);
  return h;
}

describe("padding", () => {
  it("forwards only the padded ciphertext sizes", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 600 });
    await a.next();
    const b = await connect(id);
    await b.next();
    await a.next();
    for (const n of CT_CHARS) {
      b.send(fakeMsg(n));
      expect(await a.next()).toEqual(fakeMsg(n));
    }
    // a fresh connection, so the per-connection rate limit doesn't get in the way
    const c = await connect(id);
    await c.next();
    await a.next();
    await b.next();
    for (const n of [64, CT_CHARS[0]! + 1, CT_CHARS[1]! - 1]) {
      c.send(fakeMsg(n));
      expect(await c.next()).toEqual({ t: "error", code: "bad" });
    }
    await tick();
    expect(a.queue).toEqual([]);
  });
});

describe("4 words", () => {
  it("a create registers the words; a knock finds the room and lands in its lobby", async () => {
    const { id, words, a } = await roomWithWords();
    expect(await runInDurableObject(doorStub(words), async (_i, s) => [...(await s.storage.list()).keys()].sort())).toEqual([
      "expiresAt",
      "roomId",
    ]);
    const k = await knock(words);
    const h = await hello(k);
    expect(h).toMatchObject({ lobby: true, n: 1 });
    expect(h.tag).toMatch(/^[A-Za-z0-9_-]{11}$/);
    // a knocker isn't a person in the room: no presence for it
    await tick();
    expect(a.queue).toEqual([]);
    // the room itself still stores only its expiry
    expect(await storageKeys(id)).toEqual(["expiresAt"]);
  });

  it("unknown words are refused, through the door, storing nothing", async () => {
    const words = randomWords();
    const k = await knock(words);
    expect(await k.next()).toEqual({ t: "error", code: "not_found" });
    expect((await k.closed).code).toBe(CLOSE.not_found);
    expect(await runInDurableObject(doorStub(words), async (_i, s) => (await s.storage.list()).size)).toBe(0);
  });

  it("words that point to a live room can't be registered again", async () => {
    const { words } = await roomWithWords();
    const b = await connect(randomRoomId(), { create: 600, words });
    expect(await b.next()).toEqual({ t: "error", code: "taken" });
    expect((await b.closed).code).toBe(CLOSE.taken);
  });

  it("words expire with their room", async () => {
    const { words } = await roomWithWords();
    const door = doorStub(words);
    await runInDurableObject(door, (_i, s) => s.storage.put("expiresAt", Date.now() - 1));
    expect(await runDurableObjectAlarm(door)).toBe(true);
    expect(await runInDurableObject(door, async (_i, s) => (await s.storage.list()).size)).toBe(0);
    const k = await knock(words);
    expect(await k.next()).toEqual({ t: "error", code: "not_found" });
    // and they're free for a new room
    const b = await connect(randomRoomId(), { create: 600, words });
    expect(await b.next()).toMatchObject({ t: "hello" });
  });

  it("words of a melted room lead to 'gone'", async () => {
    const id = randomRoomId();
    const words = randomWords();
    const a = await connect(id, { create: 600, words });
    await a.next();
    await setStored(id, "expiresAt", Date.now() - 1);
    await runDurableObjectAlarm(roomStub(id));
    const k = await knock(words);
    expect(await k.next()).toEqual({ t: "error", code: "gone" });
  });

  it(`limits knocks to ${WORDS_BURST} in a row per address`, async () => {
    const ip = randomIp();
    for (let i = 0; i < WORDS_BURST; i++) {
      const k = await knock(randomWords(), { ip });
      expect(await k.next()).toEqual({ t: "error", code: "not_found" });
    }
    const k = await knock(randomWords(), { ip });
    expect(await k.next()).toEqual({ t: "error", code: "slow" });
    expect((await k.closed).code).toBe(CLOSE.slow);
    // another address is unaffected
    const other = await knock(randomWords());
    expect(await other.next()).toEqual({ t: "error", code: "not_found" });
  });

  it("refuses malformed words with a plain 400 or error bad", async () => {
    const { rawFetch } = await import("./helpers");
    for (const p of ["melty.v1, w.1-2-3", "melty.v1, w.1296-1-2-3", "melty.v1, w.01-2-3-4", "melty.v1, w.1-2-3-4, o.x"]) {
      expect((await rawFetch("", { protocol: p })).status).toBe(400);
    }
    // words on a plain join (no create) don't make sense
    const id = randomRoomId();
    const a = await connect(id, { create: 600 });
    await a.next();
    const b = await connect(id, { words: "1-2-3-4" });
    expect(await b.next()).toEqual({ t: "error", code: "bad" });
  });
});

describe("lobby", () => {
  it("a knocker never sees room traffic and can only send key-exchange frames", async () => {
    const { words, a } = await roomWithWords();
    const k = await knock(words);
    await hello(k);
    a.send(fakeMsg());
    k.send(fakeMsg());
    expect(await k.next()).toEqual({ t: "error", code: "bad" });
    k.send({ t: "lock", owner: "A".repeat(43), on: true });
    expect(await k.next()).toEqual({ t: "error", code: "bad" });
    await tick();
    expect(k.queue).toEqual([]);
    expect(a.queue).toEqual([]);
  });

  it("routes key-exchange frames: knocker → members, member → that knocker only", async () => {
    const { id, words, a, tag: aTag } = await roomWithWords();
    const b = await connect(id);
    await hello(b);
    await a.next(); // presence
    const k1 = await knock(words);
    const k1Tag = (await hello(k1)).tag;
    const k2 = await knock(words);
    await hello(k2);

    // a knock goes to every member
    k1.send({ t: "kx", d: "cmVx" });
    expect(await a.next()).toEqual({ t: "kx", from: k1Tag, d: "cmVx" });
    expect(await b.next()).toEqual({ t: "kx", from: k1Tag, d: "cmVx" });
    // the answer goes to that knocker alone
    a.send({ t: "kx", to: k1Tag, d: "b2ZmZXI" });
    expect(await k1.next()).toEqual({ t: "kx", from: aTag, d: "b2ZmZXI" });
    // and the knocker can answer one member
    k1.send({ t: "kx", to: aTag, d: "YW5z" });
    expect(await a.next()).toEqual({ t: "kx", from: k1Tag, d: "YW5z" });
    await tick();
    expect(k2.queue).toEqual([]);
    expect(b.queue).toEqual([]);
  });

  it("a knocker can't address another knocker", async () => {
    const { words } = await roomWithWords();
    const k1 = await knock(words);
    await hello(k1);
    const k2 = await knock(words);
    const k2Tag = (await hello(k2)).tag;
    k1.send({ t: "kx", to: k2Tag, d: "aGk" });
    await tick();
    expect(k2.queue).toEqual([]);
  });

  it("members exchange key frames too (link joins), never echoed to the sender", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 600 });
    const aTag = (await hello(a)).tag;
    const b = await connect(id);
    const bTag = (await hello(b)).tag;
    await a.next();
    b.send({ t: "kx", d: "cmVx" });
    expect(await a.next()).toEqual({ t: "kx", from: bTag, d: "cmVx" });
    a.send({ t: "kx", to: bTag, d: "b2s" });
    expect(await b.next()).toEqual({ t: "kx", from: aTag, d: "b2s" });
    await tick();
    expect(a.queue).toEqual([]);
  });

  it("refuses malformed or oversized key-exchange frames", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 600 });
    await hello(a);
    a.send({ t: "kx", d: "" });
    expect(await a.next()).toEqual({ t: "error", code: "bad" });
    a.send({ t: "kx", d: "a+b" });
    expect(await a.next()).toEqual({ t: "error", code: "bad" });
    a.send({ t: "kx", to: "short", d: "aGk" });
    expect(await a.next()).toEqual({ t: "error", code: "bad" });
    a.send({ t: "kx", d: "A".repeat(MAX_KX_CHARS + 1) });
    expect(await a.next()).toEqual({ t: "error", code: "too_big" });
  });

  it(`takes at most ${MAX_LOBBY} knockers at once`, async () => {
    const { words } = await roomWithWords();
    for (let i = 0; i < MAX_LOBBY; i++) await hello(await knock(words));
    const extra = await knock(words);
    expect(await extra.next()).toEqual({ t: "error", code: "full" });
  });

  it("old knockers make room for new ones", async () => {
    const { id, words } = await roomWithWords();
    for (let i = 0; i < MAX_LOBBY; i++) await hello(await knock(words));
    // age every knocker past the lobby limit
    await runInDurableObject(roomStub(id), (_i, state) => {
      for (const ws of state.getWebSockets()) {
        const att = ws.deserializeAttachment() as { lobby?: true; since: number } | null;
        if (att?.lobby) ws.serializeAttachment({ ...att, since: Date.now() - LOBBY_MS - 1 });
      }
    });
    const k = await knock(words);
    expect(await k.next()).toMatchObject({ t: "hello", lobby: true });
  });

  it("locking the room sends knockers away and refuses new ones", async () => {
    const owner = await makeOwner();
    const { words, a } = await roomWithWords({ owner: owner.hash });
    const k = await knock(words);
    await hello(k);
    a.send({ t: "lock", owner: owner.secret, on: true });
    expect(await a.next()).toEqual({ t: "locked", on: true });
    expect(await k.next()).toEqual({ t: "error", code: "locked" });
    expect((await k.closed).code).toBe(CLOSE.locked);
    const k2 = await knock(words);
    expect(await k2.next()).toEqual({ t: "error", code: "locked" });
  });

  it("when the last member leaves, knockers are told nobody is inside", async () => {
    const { words, a } = await roomWithWords();
    const k = await knock(words);
    await hello(k);
    a.ws.close(1000);
    expect(await k.next()).toEqual({ t: "error", code: "not_found" });
    // and a knock on an empty room is refused straight away
    const k2 = await knock(words);
    expect(await k2.next()).toEqual({ t: "error", code: "not_found" });
  });
});

describe("creating", () => {
  it("a create for a room id that's already live is refused", async () => {
    const id = randomRoomId();
    const a = await connect(id, { create: 600 });
    await hello(a);
    const b = await connect(id, { create: 3600 });
    expect(await b.next()).toEqual({ t: "error", code: "taken" });
  });

  it("the creator retrying its own create just gets back in", async () => {
    const owner = await makeOwner();
    const id = randomRoomId();
    const a = await connect(id, { create: 600, owner: owner.hash });
    await hello(a);
    const again = await connect(id, { create: 600, owner: owner.hash });
    expect(await again.next()).toMatchObject({ t: "hello", n: 2 });
  });
});
