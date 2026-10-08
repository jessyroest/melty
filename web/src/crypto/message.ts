import { MAX_PLAINTEXT_BYTES } from "@relay/protocol";
import type { Bytes } from "../lib/b64url";

/** What's inside the ciphertext. System events (join/leave/nick) are encrypted too. */
export type Inner =
  | { v: 1; kind: "chat"; nick: string; text: string; ts: number }
  | { v: 1; kind: "join" | "leave"; nick: string; ts: number }
  | { v: 1; kind: "nick"; nick: string; prev: string; ts: number };

export const MAX_NICK = 32;
const KINDS = new Set(["chat", "join", "leave", "nick"]);

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export class TooLarge extends Error {}

export function encodeInner(m: Inner): Bytes {
  const b = enc.encode(JSON.stringify(m));
  if (b.length > MAX_PLAINTEXT_BYTES) throw new TooLarge();
  return b;
}

export function encodedSize(m: Inner): number {
  return enc.encode(JSON.stringify(m)).length;
}

export function decodeInner(b: Uint8Array): Inner | null {
  let v: unknown;
  try {
    v = JSON.parse(dec.decode(b));
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const m = v as Record<string, unknown>;
  if (m.v !== 1 || typeof m.kind !== "string" || !KINDS.has(m.kind)) return null;
  if (!validNick(m.nick) || typeof m.ts !== "number" || !Number.isFinite(m.ts)) return null;
  if (m.kind === "chat" && (typeof m.text !== "string" || m.text.length === 0)) return null;
  if (m.kind === "nick" && !validNick(m.prev)) return null;
  return m as Inner;
}

function validNick(n: unknown): n is string {
  return typeof n === "string" && n.length > 0 && n.length <= MAX_NICK;
}

/** trim, drop control characters, collapse whitespace, cap length */
export function cleanNick(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NICK);
}
