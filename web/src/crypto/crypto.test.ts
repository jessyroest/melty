import { describe, expect, it } from "vitest";
import { fromB64url, toB64url } from "../lib/b64url";
import { open, seal } from "./aead";
import { deriveRoom, newSecret, SECRET_BYTES } from "./derive";
import { decodeInner, encodeInner, newMsgId, TooLarge } from "./message";

const enc = new TextEncoder();
const dec = new TextDecoder();

function flip(b64: string, at = 0): string {
  const b = fromB64url(b64);
  b[at] = b[at]! ^ 0x01;
  return toB64url(b);
}

describe("b64url", () => {
  it("roundtrips every length", () => {
    for (let n = 0; n < 40; n++) {
      const b = crypto.getRandomValues(new Uint8Array(n));
      const s = toB64url(b);
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(fromB64url(s)).toEqual(b);
    }
  });
  it("rejects non-url alphabets", () => {
    expect(() => fromB64url("ab+/")).toThrow();
  });
});

describe("hkdf derivation", () => {
  it("same secret gives the same roomId and key", async () => {
    const secret = newSecret();
    const a = await deriveRoom(secret);
    const b = await deriveRoom(secret.slice());
    expect(a.roomId).toBe(b.roomId);
    const sealed = await seal(a.key, a.aad, enc.encode("hi"));
    expect(dec.decode(await open(b.key, b.aad, sealed))).toBe("hi");
  });

  it("different secrets give different roomIds and keys", async () => {
    const a = await deriveRoom(newSecret());
    const b = await deriveRoom(newSecret());
    expect(a.roomId).not.toBe(b.roomId);
    const sealed = await seal(a.key, a.aad, enc.encode("hi"));
    await expect(open(b.key, a.aad, sealed)).rejects.toThrow();
  });

  it("roomId doesn't contain or equal the secret", async () => {
    for (let i = 0; i < 20; i++) {
      const secret = newSecret();
      const { roomId, aad } = await deriveRoom(secret);
      expect(aad).not.toEqual(secret);
      expect(roomId).not.toBe(toB64url(secret));
      // no 8-byte window of the secret shows up in the roomId bytes
      const idHex = Buffer.from(aad).toString("hex");
      for (let j = 0; j + 8 <= SECRET_BYTES; j += 4) {
        expect(idHex).not.toContain(Buffer.from(secret.subarray(j, j + 8)).toString("hex"));
      }
    }
  });

  it("roomId and key are independent outputs (key can't be read back)", async () => {
    const { key, roomId } = await deriveRoom(newSecret());
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
    expect(fromB64url(roomId)).toHaveLength(32);
  });

  it("only accepts 32-byte secrets", async () => {
    await expect(deriveRoom(new Uint8Array(16))).rejects.toThrow();
  });
});

describe("aes-gcm", () => {
  it("roundtrips", async () => {
    const { key, aad } = await deriveRoom(newSecret());
    const msg = enc.encode("the ice is thin 🧊");
    expect(dec.decode(await open(key, aad, await seal(key, aad, msg)))).toBe("the ice is thin 🧊");
  });

  it("uses a fresh IV every time", async () => {
    const { key, aad } = await deriveRoom(newSecret());
    const ivs = new Set<string>();
    for (let i = 0; i < 50; i++) ivs.add((await seal(key, aad, enc.encode("x"))).iv);
    expect(ivs.size).toBe(50);
  });

  it("fails with the wrong key", async () => {
    const a = await deriveRoom(newSecret());
    const b = await deriveRoom(newSecret());
    const sealed = await seal(a.key, a.aad, enc.encode("secret"));
    await expect(open(b.key, a.aad, sealed)).rejects.toThrow();
  });

  it("fails on a tampered ciphertext, tag, IV or AAD", async () => {
    const { key, aad } = await deriveRoom(newSecret());
    const sealed = await seal(key, aad, enc.encode("secret message"));
    const ctLen = fromB64url(sealed.ct).length;
    await expect(open(key, aad, { ...sealed, ct: flip(sealed.ct, 0) })).rejects.toThrow();
    await expect(open(key, aad, { ...sealed, ct: flip(sealed.ct, ctLen - 1) })).rejects.toThrow();
    await expect(open(key, aad, { ...sealed, iv: flip(sealed.iv, 5) })).rejects.toThrow();
    const otherAad = aad.slice();
    otherAad[0] = otherAad[0]! ^ 1;
    await expect(open(key, otherAad, sealed)).rejects.toThrow();
  });

  it("binds messages to their room (AAD = roomId)", async () => {
    const secret = newSecret();
    const a = await deriveRoom(secret);
    const b = await deriveRoom(newSecret());
    const sealed = await seal(a.key, a.aad, enc.encode("only for room a"));
    await expect(open(a.key, b.aad, sealed)).rejects.toThrow();
  });
});

describe("inner messages", () => {
  it("roundtrips and validates", () => {
    const m = { v: 1, kind: "chat", id: newMsgId(), nick: "quiet-otter", text: "hello", ts: 1 } as const;
    expect(decodeInner(encodeInner(m))).toEqual(m);
    expect(decodeInner(enc.encode('{"v":2}'))).toBeNull();
    expect(decodeInner(enc.encode("nope"))).toBeNull();
    expect(decodeInner(enc.encode('{"v":1,"kind":"chat","nick":"a","text":"","ts":1}'))).toBeNull();
  });

  it("refuses plaintext over 4 KB", () => {
    expect(() => encodeInner({ v: 1, kind: "chat", id: newMsgId(), nick: "a", text: "x".repeat(4096), ts: 1 })).toThrow(
      TooLarge,
    );
  });

  const raw = (o: object) => new TextEncoder().encode(JSON.stringify(o));

  it("message ids are 8 random bytes, base64url", () => {
    const ids = new Set(Array.from({ length: 50 }, newMsgId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });

  it("accepts burn-after-read chat, typing and reactions", () => {
    const id = newMsgId();
    const burn = { v: 1, kind: "chat", id, nick: "a", text: "gone soon", ts: 1, burn: true } as const;
    expect(decodeInner(encodeInner(burn))).toEqual(burn);
    const typing = { v: 1, kind: "typing", nick: "a", ts: 1 } as const;
    expect(decodeInner(encodeInner(typing))).toEqual(typing);
    const react = { v: 1, kind: "react", nick: "a", target: id, emoji: "🧊", on: true, ts: 1 } as const;
    expect(decodeInner(encodeInner(react))).toEqual(react);
  });

  it("rejects malformed new kinds", () => {
    const id = newMsgId();
    // chat without an id, with a bad id, or a non-true burn flag
    expect(decodeInner(raw({ v: 1, kind: "chat", nick: "a", text: "x", ts: 1 }))).toBeNull();
    expect(decodeInner(raw({ v: 1, kind: "chat", id: "short", nick: "a", text: "x", ts: 1 }))).toBeNull();
    expect(decodeInner(raw({ v: 1, kind: "chat", id, nick: "a", text: "x", ts: 1, burn: "yes" }))).toBeNull();
    // reactions only from the fixed set, on a real id, with a boolean
    expect(decodeInner(raw({ v: 1, kind: "react", nick: "a", target: id, emoji: "💀", on: true, ts: 1 }))).toBeNull();
    expect(decodeInner(raw({ v: 1, kind: "react", nick: "a", target: "nope", emoji: "🧊", on: true, ts: 1 }))).toBeNull();
    expect(decodeInner(raw({ v: 1, kind: "react", nick: "a", target: id, emoji: "🧊", on: 1, ts: 1 }))).toBeNull();
    // unknown kinds and missing nicks
    expect(decodeInner(raw({ v: 1, kind: "file", nick: "a", ts: 1 }))).toBeNull();
    expect(decodeInner(raw({ v: 1, kind: "typing", ts: 1 }))).toBeNull();
  });
});
