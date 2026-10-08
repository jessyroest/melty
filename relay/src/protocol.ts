// Wire protocol shared by relay and web. The relay only ever sees
// base64url iv/ct; everything meaningful is inside the ciphertext.

export const MAX_PARTICIPANTS = 8;
/** max plaintext size of one message (bytes, UTF-8 JSON) */
export const MAX_PLAINTEXT_BYTES = 4096;
/** AES-GCM tag is 16 bytes; base64url without padding */
export const MAX_CT_CHARS = Math.ceil(((MAX_PLAINTEXT_BYTES + 16) * 4) / 3);
export const IV_CHARS = 16; // 12 bytes
export const MAX_FRAME_CHARS = MAX_CT_CHARS + 64;

export const RATE_PER_SEC = 5;
export const RATE_BURST = 5;

export const TTL_OPTIONS = [600, 3600, 86400] as const;
export type Ttl = (typeof TTL_OPTIONS)[number];

/** best guess of a room's total lifetime (seconds) from what's left, when nobody online can tell */
export function inferTtl(remainingMs: number): Ttl {
  return TTL_OPTIONS.find((t) => t * 1000 >= remainingMs) ?? TTL_OPTIONS[TTL_OPTIONS.length - 1]!;
}

/** after expiry the roomId stays refused for this long, then the tombstone is wiped too */
export const GONE_MARGIN_MS = 24 * 60 * 60 * 1000;

export const CREATE_LIMIT_PER_HOUR = 20;

/** roomId = 32 bytes, base64url */
export const ROOM_ID_RE = /^[A-Za-z0-9_-]{43}$/;
export const B64URL_RE = /^[A-Za-z0-9_-]*$/;

export type ErrorCode = "bad" | "not_found" | "gone" | "full" | "too_big" | "rate" | "limit";

export const CLOSE = {
  expired: 4001,
  bad: 4000,
  not_found: 4004,
  gone: 4010,
  full: 4009,
  too_big: 4013,
  rate: 4029,
  limit: 4030,
} as const;

export type ClientFrame = { t: "msg"; iv: string; ct: string } | { t: "ping" };

export type ServerFrame =
  | { t: "hello"; now: number; expiresAt: number; ttl: number; n: number }
  | { t: "presence"; n: number }
  | { t: "msg"; iv: string; ct: string }
  | { t: "pong" }
  | { t: "expired" }
  | { t: "error"; code: ErrorCode };
