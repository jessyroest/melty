import { MAX_PLAINTEXT_BYTES, PAD_BUCKETS } from "@relay/protocol";
import { describe, expect, it } from "vitest";
import { fromB64url, toB64url } from "../lib/b64url";
import { deriveLink, deriveRoom, newSecret } from "./derive";
import { LEAVE_COUNTER, newSenderId, openMsg, pad, ReplayGuard, sealMsg, unpad } from "./frame";
import {
  type Bundle,
  decodeKx,
  encodeKx,
  hostAccept,
  hostKeys,
  joinerAnswer,
  type KxMode,
  newHandshakeId,
  openBundle,
  safetyCode,
  sealBundle,
} from "./kx";
import { codeToWire, codeWords, newDoorCode, parseDoorCode, safetyWords } from "./words";
import { WORDS } from "./wordlist";

const enc = new TextEncoder();
const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));

function bundle(): Bundle {
  return { key: rnd(32), link: newSecret(), code: newDoorCode(), host: "quiet-otter" };
}

/** one honest handshake, as the two sides would run it */
function handshake(mode: KxMode, joinerPsk: Uint8Array<ArrayBuffer> | null, hostPsk: Uint8Array<ArrayBuffer> | null) {
  const hs = newHandshakeId();
  const keys = hostKeys();
  const j = joinerAnswer(mode, hs, { x: keys.xPk, m: keys.mPk }, joinerPsk);
  if (!j) throw new Error("joiner failed");
  const h = hostAccept(mode, hs, keys, j.ans, hostPsk);
  return { hs, keys, j, h };
}

describe("hybrid key exchange (X25519 + ML-KEM-768)", () => {
  it("both sides arrive at the same secret, transcript and safety code (code mode)", async () => {
    const { hs, j, h } = handshake("code", null, null);
    expect(h).not.toBeNull();
    expect(h!.bundleKey).toEqual(j.result.bundleKey);
    expect(h!.th).toEqual(j.result.th);
    expect(safetyCode(h!.th)).toEqual(safetyCode(j.result.th));
    expect(safetyCode(h!.th)).toHaveLength(6);
    const b = bundle();
    const sealed = await sealBundle(h!, hs, b);
    expect(await openBundle(j.result, sealed)).toEqual(b);
  });

  it("both sides arrive at the same secret in link mode, with the psk", async () => {
    const { psk } = await deriveLink(newSecret());
    const { hs, j, h } = handshake("link", psk, psk);
    expect(h).not.toBeNull();
    expect(h!.bundleKey).toEqual(j.result.bundleKey);
    const b = bundle();
    expect(await openBundle(j.result, await sealBundle(h!, hs, b))).toEqual(b);
  });

  it("every handshake is fresh: new keys, new transcript, new code", () => {
    const a = handshake("code", null, null);
    const b = handshake("code", null, null);
    expect(a.keys.xPk).not.toEqual(b.keys.xPk);
    expect(a.h!.th).not.toEqual(b.h!.th);
    expect(safetyCode(a.h!.th)).not.toEqual(safetyCode(b.h!.th));
  });

  it("a man in the middle (code mode) ends up with a different safety code on each side", async () => {
    const hs = newHandshakeId();
    // the real host
    const host = hostKeys();
    // the relay answers the host as if it were the joiner...
    const toHost = joinerAnswer("code", hs, { x: host.xPk, m: host.mPk }, null)!;
    const hostSide = hostAccept("code", hs, host, toHost.ans, null)!;
    // ...and offers its own keys to the real joiner
    const fake = hostKeys();
    const joiner = joinerAnswer("code", hs, { x: fake.xPk, m: fake.mPk }, null)!;
    const joinerSide = joiner.result;
    expect(safetyCode(hostSide.th)).not.toEqual(safetyCode(joinerSide.th));
    // and the joiner's view differs from anything the host computed
    expect(joinerSide.bundleKey).not.toEqual(hostSide.bundleKey);
  });

  it("link mode: a man in the middle without the psk is refused by the host", async () => {
    const { psk } = await deriveLink(newSecret());
    const hs = newHandshakeId();
    const host = hostKeys();
    // the relay doesn't have the psk: no MAC, or a MAC made with a guess
    const noMac = joinerAnswer("code", hs, { x: host.xPk, m: host.mPk }, null)!;
    expect(hostAccept("link", hs, host, noMac.ans, psk)).toBeNull();
    const guess = joinerAnswer("link", hs, { x: host.xPk, m: host.mPk }, rnd(32))!;
    expect(hostAccept("link", hs, host, guess.ans, psk)).toBeNull();
  });

  it("link mode: a bundle sealed by someone without the psk doesn't open", async () => {
    const { psk } = await deriveLink(newSecret());
    const hs = newHandshakeId();
    // the relay pretends to be the host
    const fake = hostKeys();
    const joiner = joinerAnswer("link", hs, { x: fake.xPk, m: fake.mPk }, psk)!;
    // it can decapsulate and do the ECDH (they're its keys), but without the psk its bundle key is wrong
    const relaySide = hostAccept("code", hs, fake, { x: joiner.ans.x, c: joiner.ans.c }, null)!;
    expect(relaySide).not.toBeNull();
    const forged = await sealBundle(relaySide, hs, bundle());
    await expect(openBundle(joiner.result, forged)).rejects.toThrow();
    // and it can't check the joiner's MAC against a guessed psk either
    expect(hostAccept("link", hs, fake, joiner.ans, rnd(32))).toBeNull();
  });

  it("a tampered answer gives different keys (or is refused)", () => {
    const hs = newHandshakeId();
    const keys = hostKeys();
    const j = joinerAnswer("code", hs, { x: keys.xPk, m: keys.mPk }, null)!;
    const c = j.ans.c.slice();
    c[10] = c[10]! ^ 1;
    const h = hostAccept("code", hs, keys, { ...j.ans, c }, null);
    // ML-KEM's implicit rejection: a key comes out, just not the same one
    expect(h?.bundleKey).not.toEqual(j.result.bundleKey);
  });

  it("refuses low-order X25519 points", () => {
    const keys = hostKeys();
    expect(joinerAnswer("code", newHandshakeId(), { x: new Uint8Array(32), m: keys.mPk }, null)).toBeNull();
  });

  it("a bundle doesn't open with another handshake's key", async () => {
    const a = handshake("code", null, null);
    const b = handshake("code", null, null);
    const sealed = await sealBundle(a.h!, a.hs, bundle());
    await expect(openBundle(b.j.result, sealed)).rejects.toThrow();
  });
});

describe("kx wire format", () => {
  it("roundtrips every kind", () => {
    const hs = newHandshakeId();
    const keys = hostKeys();
    const j = joinerAnswer("link", hs, { x: keys.xPk, m: keys.mPk }, rnd(32))!;
    const msgs = [
      { k: "req", hs, mode: "code" },
      { k: "offer", hs, x: keys.xPk, m: keys.mPk },
      j.ans,
      { k: "key", hs, iv: rnd(12), ct: rnd(200) },
      { k: "no", hs },
    ] as const;
    for (const m of msgs) {
      const d = encodeKx(m);
      expect(d).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(d.length).toBeLessThan(4096);
      expect(decodeKx(d)).toEqual(m);
    }
  });

  it("rejects wrong lengths and junk", () => {
    const hs = newHandshakeId();
    const raw = (o: object) => toB64url(enc.encode(JSON.stringify(o)));
    expect(decodeKx(raw({ k: "req", hs: toB64url(hs), mode: "door" }))).toBeNull();
    expect(decodeKx(raw({ k: "req", hs: toB64url(rnd(8)), mode: "code" }))).toBeNull();
    expect(decodeKx(raw({ k: "offer", hs: toB64url(hs), x: toB64url(rnd(31)), m: toB64url(rnd(1184)) }))).toBeNull();
    expect(decodeKx(raw({ k: "ans", hs: toB64url(hs), x: toB64url(rnd(32)), c: toB64url(rnd(1000)) }))).toBeNull();
    expect(decodeKx(raw({ k: "key", hs: toB64url(hs), iv: toB64url(rnd(12)), ct: toB64url(rnd(5000)) }))).toBeNull();
    expect(decodeKx(raw([1, 2]))).toBeNull();
    expect(decodeKx("!!")).toBeNull();
  });
});

describe("message frames: padding, header, replay", () => {
  it("pads to fixed buckets and back", () => {
    for (const n of [0, 1, 100, 254, 255, 1000, 1022, 1023, 3000, MAX_PLAINTEXT_BYTES]) {
      const p = rnd(n);
      const padded = pad(p);
      expect(PAD_BUCKETS as readonly number[]).toContain(padded.length);
      expect(unpad(padded)).toEqual(p);
    }
    expect(() => pad(rnd(MAX_PLAINTEXT_BYTES + 1))).toThrow();
  });

  it("a typing notice and a short chat line have the same ciphertext length", async () => {
    const { key, aad } = await deriveRoom(newSecret(), rnd(32));
    const s = newSenderId();
    const a = await sealMsg(key, aad, s, 0, enc.encode('{"kind":"typing"}'));
    const b = await sealMsg(key, aad, s, 1, enc.encode('{"kind":"chat","text":"hey, what time is it there?"}'));
    expect(a.ct.length).toBe(b.ct.length);
  });

  it("roundtrips sender and counter, and authenticates them", async () => {
    const { key, aad } = await deriveRoom(newSecret(), rnd(32));
    const s = newSenderId();
    const sealed = await sealMsg(key, aad, s, 41, enc.encode("hi"));
    const o = await openMsg(key, aad, sealed);
    expect(o).toEqual({ sender: toB64url(s), counter: 41, plaintext: enc.encode("hi") });
    // bump the counter in the clear header: the tag no longer matches
    const all = fromB64url(sealed.ct);
    all[11] = all[11]! ^ 1;
    await expect(openMsg(key, aad, { ...sealed, ct: toB64url(all) })).rejects.toThrow();
    // swap the sender id
    const all2 = fromB64url(sealed.ct);
    all2[0] = all2[0]! ^ 1;
    await expect(openMsg(key, aad, { ...sealed, ct: toB64url(all2) })).rejects.toThrow();
  });

  it("is bound to its room", async () => {
    const k = rnd(32);
    const a = await deriveRoom(newSecret(), k);
    const b = await deriveRoom(newSecret(), k);
    const sealed = await sealMsg(a.key, a.aad, newSenderId(), 0, enc.encode("only for room a"));
    await expect(openMsg(b.key, b.aad, sealed)).rejects.toThrow();
  });

  it("the replay guard accepts each counter once, in increasing order, per sender", () => {
    const g = new ReplayGuard();
    expect(g.accept("a", 0)).toBe(true);
    expect(g.accept("a", 0)).toBe(false);
    expect(g.accept("a", 2)).toBe(true);
    expect(g.accept("a", 1)).toBe(false);
    expect(g.accept("b", 0)).toBe(true);
    expect(g.accept("a", LEAVE_COUNTER)).toBe(true);
    expect(g.accept("a", LEAVE_COUNTER)).toBe(false);
  });
});

describe("words", () => {
  it("the list is the EFF short list: 1296 unique words", () => {
    expect(WORDS).toHaveLength(1296);
    expect(new Set(WORDS).size).toBe(1296);
    expect(WORDS[0]).toBe("acid");
    expect(WORDS[1295]).toBe("zoom");
  });

  it("door codes roundtrip through words, with any separator and case", () => {
    for (let i = 0; i < 50; i++) {
      const c = newDoorCode();
      const w = codeWords(c);
      expect(parseDoorCode(w.join(" "))).toEqual(c);
      expect(parseDoorCode(w.join("-").toUpperCase())).toEqual(c);
      expect(parseDoorCode(`  ${w.join(",  ")} `)).toEqual(c);
      expect(codeToWire(c)).toMatch(/^\d{1,4}-\d{1,4}-\d{1,4}-\d{1,4}$/);
    }
  });

  it("handles the one hyphenated word", () => {
    const yoyo = WORDS.indexOf("yo-yo");
    expect(parseDoorCode("acid yo-yo zoom acre")).toEqual([0, yoyo, 1295, 2]);
    expect(parseDoorCode("acid-yo-yo-zoom-acre")).toEqual([0, yoyo, 1295, 2]);
    expect(parseDoorCode("acid yoyo zoom acre")).toEqual([0, WORDS.indexOf("yoyo"), 1295, 2]);
  });

  it("rejects wrong counts and unknown words", () => {
    expect(parseDoorCode("acid acorn acre")).toBeNull();
    expect(parseDoorCode("acid acorn acre acts afar")).toBeNull();
    expect(parseDoorCode("acid acorn acre bitcoin")).toBeNull();
  });

  it("safety words are 6 words, deterministic", () => {
    const h = rnd(32);
    expect(safetyWords(h)).toEqual(safetyWords(h.slice()));
    expect(safetyWords(h)).toHaveLength(6);
  });
});
