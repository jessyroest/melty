import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { type Bytes, fromB64url, toB64url } from "../lib/b64url";
import { open, seal } from "./aead";
import { ROOM_KEY_BYTES, SECRET_BYTES } from "./derive";
import { CODE_WORDS, type DoorCode, safetyWords } from "./words";
import { WORDS } from "./wordlist";

/**
 * The phase 2 key exchange. Someone inside the room (the host) hands the room key
 * to a newcomer (the joiner) over a hybrid X25519 + ML-KEM-768 exchange:
 *
 *   joiner → room   req    {hs, mode}
 *   host   → joiner offer  {hs, x: X25519 pk, m: ML-KEM-768 ek}      (fresh per handshake)
 *   joiner → host   ans    {hs, x: X25519 pk, c: ML-KEM ciphertext, mac?}
 *   host   → joiner key    {hs, iv, ct}  = AES-GCM(bundleKey, bundle), AAD = transcript hash
 *
 *   th     = SHA-256(transcript: version, mode, hs, host x, host m, joiner x, c)
 *   shared = HKDF-SHA256(ikm = x25519_ss || mlkem_ss, salt = th, info = "pq-hybrid-v1")
 *
 * `link` mode: both sides also hold the link's pre-shared key. The joiner proves it with
 * a MAC over th, and the bundle key mixes it in, so the relay can't sit in the middle.
 * `code` mode (4 words): the words are not a key and the relay knows them, so a person
 * inside has to let the joiner in, and the two compare a safety code made from th.
 */
export type KxMode = "link" | "code";

export const HS_BYTES = 16;
const X_BYTES = 32;
const MLKEM_EK_BYTES = 1184;
const MLKEM_CT_BYTES = 1088;
const MAC_BYTES = 32;
const IV_BYTES = 12;
/** a sealed bundle is a few hundred bytes; anything bigger is junk */
const MAX_BUNDLE_CT = 1024;

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export type KxMsg =
  | { k: "req"; hs: Bytes; mode: KxMode }
  | { k: "offer"; hs: Bytes; x: Bytes; m: Bytes }
  | { k: "ans"; hs: Bytes; x: Bytes; c: Bytes; mac?: Bytes }
  | { k: "key"; hs: Bytes; iv: Bytes; ct: Bytes }
  /** a person inside turned the knock down */
  | { k: "no"; hs: Bytes };

/** What a newcomer receives, sealed: everything needed to be a full member. */
export type Bundle = {
  /** raw room key */
  key: Bytes;
  /** the link secret, so the newcomer can share the link and host joins too */
  link: Bytes;
  /** the room's 4 words, if it has them */
  code: DoorCode | null;
  /** the host's nickname, for the safety-code prompt (unverified, like every nick) */
  host: string;
};

/** the host's per-handshake keypairs; secret halves are zeroed by `wipeHost` */
export type HostKeys = { xSk: Bytes; xPk: Bytes; mSk: Bytes; mPk: Bytes };

export type KxResult = {
  /** transcript hash: the safety code comes from this */
  th: Bytes;
  /** AES-256-GCM key for the bundle */
  bundleKey: Bytes;
};

export function newHandshakeId(): Bytes {
  return crypto.getRandomValues(new Uint8Array(HS_BYTES));
}

export function hostKeys(): HostKeys {
  const x = x25519.keygen();
  const m = ml_kem768.keygen();
  return {
    xSk: x.secretKey as Bytes,
    xPk: x.publicKey as Bytes,
    mSk: m.secretKey as Bytes,
    mPk: m.publicKey as Bytes,
  };
}

export function wipeHost(k: HostKeys): void {
  k.xSk.fill(0);
  k.mSk.fill(0);
}

/** Length-prefixed, so no two different transcripts encode to the same bytes. */
export function transcriptHash(t: { mode: KxMode; hs: Bytes; hostX: Bytes; hostM: Bytes; joinX: Bytes; c: Bytes }): Bytes {
  const h = sha256.create();
  const field = (b: Uint8Array) => {
    h.update(new Uint8Array([(b.length >>> 8) & 0xff, b.length & 0xff]));
    h.update(b);
  };
  field(enc.encode("melty-kx-v1"));
  field(enc.encode(t.mode));
  field(t.hs);
  field(t.hostX);
  field(t.hostM);
  field(t.joinX);
  field(t.c);
  return h.digest() as Bytes;
}

function combine(xss: Uint8Array, mss: Uint8Array, th: Bytes, psk: Bytes | null): Bytes {
  const ikm = new Uint8Array(xss.length + mss.length);
  ikm.set(xss);
  ikm.set(mss, xss.length);
  const shared = hkdf(sha256, ikm, th, enc.encode("pq-hybrid-v1"), 32);
  ikm.fill(0);
  // link mode: the bundle key needs the link's psk too, so only a real link holder can seal it
  const ikm2 = new Uint8Array(32 + (psk?.length ?? 0));
  ikm2.set(shared);
  if (psk) ikm2.set(psk, 32);
  const bundleKey = hkdf(sha256, ikm2, th, enc.encode("kx-bundle-v1"), 32) as Bytes;
  shared.fill(0);
  ikm2.fill(0);
  return bundleKey;
}

function joinerMac(psk: Bytes, th: Bytes): Bytes {
  const k = hkdf(sha256, psk, th, enc.encode("kx-link-joiner-v1"), 32);
  const mac = hmac(sha256, k, th) as Bytes;
  k.fill(0);
  return mac;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

/** Joiner side: answer an offer. Returns null if the host's keys are unusable. */
export function joinerAnswer(
  mode: KxMode,
  hs: Bytes,
  offer: { x: Bytes; m: Bytes },
  psk: Bytes | null,
): { ans: Extract<KxMsg, { k: "ans" }>; result: KxResult } | null {
  if ((mode === "link") !== (psk !== null)) throw new Error("link mode needs the psk, code mode must not have one");
  const xSk = x25519.utils.randomSecretKey() as Bytes;
  try {
    const joinX = x25519.getPublicKey(xSk) as Bytes;
    const xss = x25519.getSharedSecret(xSk, offer.x);
    const { cipherText, sharedSecret: mss } = ml_kem768.encapsulate(offer.m);
    const th = transcriptHash({ mode, hs, hostX: offer.x, hostM: offer.m, joinX, c: cipherText as Bytes });
    const bundleKey = combine(xss, mss, th, psk);
    xss.fill(0);
    mss.fill(0);
    const ans: Extract<KxMsg, { k: "ans" }> = { k: "ans", hs, x: joinX, c: cipherText as Bytes };
    if (psk) ans.mac = joinerMac(psk, th);
    return { ans, result: { th, bundleKey } };
  } catch {
    // a low-order X25519 point or a malformed ML-KEM key
    return null;
  } finally {
    xSk.fill(0);
  }
}

/** Host side: check the joiner's answer. Returns null on a bad MAC or bad values. */
export function hostAccept(
  mode: KxMode,
  hs: Bytes,
  keys: HostKeys,
  ans: { x: Bytes; c: Bytes; mac?: Bytes },
  psk: Bytes | null,
): KxResult | null {
  if ((mode === "link") !== (psk !== null)) throw new Error("link mode needs the psk, code mode must not have one");
  try {
    const th = transcriptHash({ mode, hs, hostX: keys.xPk, hostM: keys.mPk, joinX: ans.x, c: ans.c });
    if (psk) {
      if (!ans.mac || !sameBytes(ans.mac, joinerMac(psk, th))) return null;
    } else if (ans.mac) return null;
    const xss = x25519.getSharedSecret(keys.xSk, ans.x);
    const mss = ml_kem768.decapsulate(ans.c, keys.mSk.slice());
    const bundleKey = combine(xss, mss, th, psk);
    xss.fill(0);
    mss.fill(0);
    return { th, bundleKey };
  } catch {
    return null;
  }
}

/** the 6 words both sides compare outside the app */
export function safetyCode(th: Bytes): string[] {
  const h = sha256.create();
  h.update(enc.encode("melty-safety-v1"));
  h.update(th);
  return safetyWords(h.digest());
}

async function bundleAesKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealBundle(r: KxResult, hs: Bytes, b: Bundle): Promise<Extract<KxMsg, { k: "key" }>> {
  const json = JSON.stringify({
    v: 1,
    key: toB64url(b.key),
    link: toB64url(b.link),
    code: b.code,
    host: b.host,
  });
  const s = await seal(await bundleAesKey(r.bundleKey), r.th, enc.encode(json));
  return { k: "key", hs, iv: fromB64url(s.iv), ct: fromB64url(s.ct) };
}

/** Throws if the bundle wasn't sealed with this handshake's key, or is malformed. */
export async function openBundle(r: KxResult, msg: { iv: Bytes; ct: Bytes }): Promise<Bundle> {
  const pt = await open(await bundleAesKey(r.bundleKey), r.th, { iv: toB64url(msg.iv), ct: toB64url(msg.ct) });
  const v = JSON.parse(dec.decode(pt)) as Record<string, unknown>;
  pt.fill(0);
  if (v.v !== 1 || typeof v.key !== "string" || typeof v.link !== "string") throw new Error("bad bundle");
  const key = fromB64url(v.key);
  const link = fromB64url(v.link);
  if (key.length !== ROOM_KEY_BYTES || link.length !== SECRET_BYTES) throw new Error("bad bundle");
  let code: DoorCode | null = null;
  if (v.code !== null) {
    const c = v.code;
    if (!Array.isArray(c) || c.length !== CODE_WORDS || !c.every((i) => Number.isInteger(i) && i >= 0 && i < WORDS.length)) {
      throw new Error("bad bundle");
    }
    code = c as unknown as DoorCode;
  }
  const host = typeof v.host === "string" ? v.host.slice(0, 32) : "";
  return { key, link, code, host };
}

// ---- wire ---------------------------------------------------------------

/** a kx message as the `d` string of a relay `kx` frame */
export function encodeKx(m: KxMsg): string {
  const o: Record<string, unknown> = { k: m.k, hs: toB64url(m.hs) };
  switch (m.k) {
    case "req":
      o.mode = m.mode;
      break;
    case "offer":
      o.x = toB64url(m.x);
      o.m = toB64url(m.m);
      break;
    case "ans":
      o.x = toB64url(m.x);
      o.c = toB64url(m.c);
      if (m.mac) o.mac = toB64url(m.mac);
      break;
    case "key":
      o.iv = toB64url(m.iv);
      o.ct = toB64url(m.ct);
      break;
  }
  return toB64url(enc.encode(JSON.stringify(o)));
}

/** strict: wrong kinds, lengths or extra junk give null */
export function decodeKx(d: string): KxMsg | null {
  let o: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(dec.decode(fromB64url(d)));
    if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
    o = v as Record<string, unknown>;
  } catch {
    return null;
  }
  const bytes = (f: unknown, len: number | [number, number]): Bytes | null => {
    if (typeof f !== "string") return null;
    try {
      const b = fromB64url(f);
      const ok = typeof len === "number" ? b.length === len : b.length >= len[0] && b.length <= len[1];
      return ok ? b : null;
    } catch {
      return null;
    }
  };
  const hs = bytes(o.hs, HS_BYTES);
  if (!hs) return null;
  switch (o.k) {
    case "req":
      return o.mode === "link" || o.mode === "code" ? { k: "req", hs, mode: o.mode } : null;
    case "no":
      return { k: "no", hs };
    case "offer": {
      const x = bytes(o.x, X_BYTES);
      const m = bytes(o.m, MLKEM_EK_BYTES);
      return x && m ? { k: "offer", hs, x, m } : null;
    }
    case "ans": {
      const x = bytes(o.x, X_BYTES);
      const c = bytes(o.c, MLKEM_CT_BYTES);
      if (!x || !c) return null;
      if (o.mac === undefined) return { k: "ans", hs, x, c };
      const mac = bytes(o.mac, MAC_BYTES);
      return mac ? { k: "ans", hs, x, c, mac } : null;
    }
    case "key": {
      const iv = bytes(o.iv, IV_BYTES);
      const ct = bytes(o.ct, [17, MAX_BUNDLE_CT]);
      return iv && ct ? { k: "key", hs, iv, ct } : null;
    }
    default:
      return null;
  }
}
