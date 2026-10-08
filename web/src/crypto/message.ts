import { MAX_PLAINTEXT_BYTES } from "@relay/protocol";
import { type Bytes, toB64url } from "../lib/b64url";

export const REACTIONS = ["🧊", "💧", "🔥", "👍"] as const;
export type Reaction = (typeof REACTIONS)[number];

/** What's inside the ciphertext. System events (join/leave/nick/typing/react) are encrypted too. */
export type Inner =
  | { v: 1; kind: "chat"; id: string; nick: string; text: string; ts: number; burn?: true }
  | { v: 1; kind: "join" | "leave" | "typing"; nick: string; ts: number }
  | { v: 1; kind: "nick"; nick: string; prev: string; ts: number }
  | { v: 1; kind: "react"; nick: string; target: string; emoji: Reaction; on: boolean; ts: number };

export const MAX_NICK = 32;
const KINDS = new Set(["chat", "join", "leave", "nick", "typing", "react"]);
/** message ids: 8 random bytes, base64url */
const MSG_ID = /^[A-Za-z0-9_-]{11}$/;

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export class TooLarge extends Error {}

export function newMsgId(): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(8)));
}

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
  switch (m.kind) {
    case "chat":
      if (typeof m.text !== "string" || m.text.length === 0 || !isMsgId(m.id)) return null;
      if (m.burn !== undefined && m.burn !== true) return null;
      break;
    case "nick":
      if (!validNick(m.prev)) return null;
      break;
    case "react":
      if (!isMsgId(m.target) || typeof m.on !== "boolean") return null;
      if (!(REACTIONS as readonly unknown[]).includes(m.emoji)) return null;
      break;
  }
  return m as Inner;
}

function isMsgId(id: unknown): id is string {
  return typeof id === "string" && MSG_ID.test(id);
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
