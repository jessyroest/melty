import { MAX_PLAINTEXT_BYTES, MSG_HEADER_BYTES, PAD_BUCKETS } from "@relay/protocol";
import { type Bytes, fromB64url, toB64url } from "../lib/b64url";
import type { Sealed } from "./aead";

/**
 * Room messages on the wire: `ct = header || AES-GCM(padded plaintext)`.
 *
 *   header = sender id (8 random bytes per session) || counter (u32, big-endian)
 *   AAD    = "melty-msg-v2" || roomId || header
 *   padded = u16 length || plaintext || zeros, up to the smallest PAD_BUCKETS size
 *
 * The header is in the clear (the receiver needs it to build the AAD) and authenticated.
 * Receivers accept a sender's counter only if it is higher than the last one they saw
 * from that sender, so the relay can't replay a message to someone who already got it.
 */
const IV_BYTES = 12;
const SENDER_BYTES = 8;
/** the pre-sealed goodbye: always last, so it never collides with a real counter */
export const LEAVE_COUNTER = 0xffff_ffff;
const LABEL = new TextEncoder().encode("melty-msg-v2");

export function newSenderId(): Bytes {
  return crypto.getRandomValues(new Uint8Array(SENDER_BYTES));
}

export function pad(plaintext: Uint8Array): Bytes {
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error("too large");
  const size = PAD_BUCKETS.find((b) => b >= plaintext.length + 2)!;
  const out = new Uint8Array(size);
  out[0] = plaintext.length >>> 8;
  out[1] = plaintext.length & 0xff;
  out.set(plaintext, 2);
  return out;
}

export function unpad(padded: Uint8Array): Bytes {
  if (!(PAD_BUCKETS as readonly number[]).includes(padded.length)) throw new Error("bad padding");
  const len = (padded[0]! << 8) | padded[1]!;
  if (len + 2 > padded.length) throw new Error("bad padding");
  for (let i = len + 2; i < padded.length; i++) if (padded[i] !== 0) throw new Error("bad padding");
  return padded.slice(2, len + 2);
}

function aadFor(roomAad: Uint8Array, header: Uint8Array): Bytes {
  const out = new Uint8Array(LABEL.length + roomAad.length + header.length);
  out.set(LABEL);
  out.set(roomAad, LABEL.length);
  out.set(header, LABEL.length + roomAad.length);
  return out;
}

export async function sealMsg(key: CryptoKey, roomAad: Bytes, sender: Bytes, counter: number, plaintext: Bytes): Promise<Sealed> {
  if (sender.length !== SENDER_BYTES || !Number.isInteger(counter) || counter < 0 || counter > LEAVE_COUNTER) {
    throw new Error("bad header");
  }
  const header = new Uint8Array(MSG_HEADER_BYTES);
  header.set(sender);
  new DataView(header.buffer).setUint32(SENDER_BYTES, counter);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const padded = pad(plaintext);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aadFor(roomAad, header) }, key, padded),
  );
  padded.fill(0);
  const out = new Uint8Array(header.length + ct.length);
  out.set(header);
  out.set(ct, header.length);
  return { iv: toB64url(iv), ct: toB64url(out) };
}

export type Opened = { sender: string; counter: number; plaintext: Bytes };

/** Throws if anything doesn't match: key, IV, header, AAD, padding. */
export async function openMsg(key: CryptoKey, roomAad: Bytes, sealed: Sealed): Promise<Opened> {
  const iv = fromB64url(sealed.iv);
  const all = fromB64url(sealed.ct);
  if (iv.length !== IV_BYTES || all.length <= MSG_HEADER_BYTES) throw new Error("bad frame");
  const header = all.subarray(0, MSG_HEADER_BYTES);
  const padded = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aadFor(roomAad, header) },
      key,
      all.subarray(MSG_HEADER_BYTES),
    ),
  );
  const plaintext = unpad(padded);
  padded.fill(0);
  return {
    sender: toB64url(header.subarray(0, SENDER_BYTES)),
    counter: new DataView(header.buffer, header.byteOffset).getUint32(SENDER_BYTES),
    plaintext,
  };
}

/** Per sender, the highest counter seen. A message at or below it is a replay. */
export class ReplayGuard {
  private seen = new Map<string, number>();

  /** true (and remembered) if this is new; false for a replay */
  accept(sender: string, counter: number): boolean {
    const last = this.seen.get(sender);
    if (last !== undefined && counter <= last) return false;
    this.seen.set(sender, counter);
    return true;
  }

  clear(): void {
    this.seen.clear();
  }
}
