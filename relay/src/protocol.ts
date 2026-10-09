// Wire protocol shared by relay and web. The relay only ever sees
// base64url iv/ct; everything meaningful is inside the ciphertext.

export const MAX_PARTICIPANTS = 8;
/** max plaintext size of one message (bytes, UTF-8 JSON) */
export const MAX_PLAINTEXT_BYTES = 4096;
/**
 * Every message is padded before it is encrypted: [u16 length][plaintext][zeros] up to the
 * smallest of these sizes, so the relay only ever sees three ciphertext lengths.
 */
export const PAD_BUCKETS = [256, 1024, 4352] as const;
/** in front of the ciphertext, in the clear and in the AAD: sender id (8 bytes) + counter (u32) */
export const MSG_HEADER_BYTES = 12;
const GCM_TAG_BYTES = 16;
/** base64url length (no padding) of n bytes */
export const b64Chars = (n: number) => Math.ceil((n * 4) / 3);
/** the only ciphertext lengths (base64url chars) a message can have */
export const CT_CHARS: readonly number[] = PAD_BUCKETS.map((b) => b64Chars(MSG_HEADER_BYTES + b + GCM_TAG_BYTES));
export const MAX_CT_CHARS = Math.max(...CT_CHARS);
export const IV_CHARS = 16; // 12 bytes
/** a key-exchange payload (base64url); the biggest, an ML-KEM-768 offer, is about 2.2k */
export const MAX_KX_CHARS = 4096;
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

/** WebSocket connection attempts per IP (joins, creates, reconnects): a token bucket, 60 per minute with a burst of 60 */
export const CONNECT_PER_MIN = 60;
export const CONNECT_BURST = 60;

/** a room's message budget, shared by all its sockets (in the room object's memory only) */
export const ROOM_RATE_PER_SEC = 20;
export const ROOM_BURST = 20;

/**
 * Transport. The client connects to the fixed path `/ws`; nothing about the room
 * travels in the URL. Everything goes in the `Sec-WebSocket-Protocol` header,
 * as HTTP tokens (base64url and `.` are token characters):
 *   melty.v1, r.<roomId>[, c.<ttl>][, o.<ownerHash>]
 * The relay's 101 response always selects exactly `melty.v1`.
 */
export const WS_PATH = "/ws";
export const SUBPROTOCOL = "melty.v1";
export const PROTO_ROOM = "r.";
export const PROTO_CREATE = "c.";
export const PROTO_OWNER = "o.";
/** the room's 4 words, as word indices: `w.12-345-6-1295`. On a create it registers them; alone it knocks. */
export const PROTO_WORDS = "w.";
export const WORD_COUNT = 1296;
export const WORDS_RE = /^(\d{1,4})-(\d{1,4})-(\d{1,4})-(\d{1,4})$/;
/** canonical words entry (no leading zeros, every index < WORD_COUNT), or null */
export function parseWordsEntry(v: string): string | null {
  const m = WORDS_RE.exec(v);
  if (!m) return null;
  const idx = m.slice(1).map(Number);
  if (idx.some((i) => i >= WORD_COUNT)) return null;
  const canon = idx.join("-");
  return canon === v ? canon : null;
}

/** looking up 4 words: per IP, a token bucket of 10 per minute (burst 10), on top of the connection limit */
export const WORDS_PER_MIN = 10;
export const WORDS_BURST = 10;
/** at most this many knocking (not yet let in) sockets per room; older than LOBBY_MS they are closed */
export const MAX_LOBBY = 4;
export const LOBBY_MS = 3 * 60 * 1000;
/** per-socket tag, so key-exchange frames can be addressed: 8 random bytes, base64url */
export const TAG_RE = /^[A-Za-z0-9_-]{11}$/;

/** roomId = 32 bytes, base64url */
export const ROOM_ID_RE = /^[A-Za-z0-9_-]{43}$/;
export const B64URL_RE = /^[A-Za-z0-9_-]*$/;
/** the creator's proof: a 32-byte secret (base64url); the relay only ever learns its SHA-256 until it's used */
export const OWNER_RE = /^[A-Za-z0-9_-]{43}$/;

export type ErrorCode =
  | "bad"
  | "not_found"
  | "gone"
  | "full"
  | "too_big"
  | "rate"
  | "limit"
  | "slow"
  | "locked"
  /** a create whose room id or words are already in use */
  | "taken";

export const CLOSE = {
  expired: 4001,
  melted: 4002,
  bad: 4000,
  locked: 4023,
  not_found: 4004,
  gone: 4010,
  full: 4009,
  too_big: 4013,
  rate: 4029,
  limit: 4030,
  /** too many connection attempts from one address */
  slow: 4031,
  taken: 4032,
  /** a knocking socket that waited too long */
  timeout: 4008,
} as const;

/** an error code a refusal can carry (not the room-ending reasons, which have their own frames) */
export function isErrorCode(code: string): code is ErrorCode {
  return code !== "expired" && code !== "melted" && code !== "timeout" && Object.hasOwn(CLOSE, code);
}

export type ClientFrame =
  | { t: "msg"; iv: string; ct: string }
  /** key exchange: to one socket (by tag), or to every member when `to` is absent */
  | { t: "kx"; to?: string; d: string }
  | { t: "ping" }
  /** creator only: wipe the room for everyone right now */
  | { t: "melt"; owner: string }
  /** creator only: refuse (or allow again) new people */
  | { t: "lock"; owner: string; on: boolean };

export type ServerFrame =
  /** `tag` is this socket's address for key-exchange frames; `lobby` = knocking, not a member yet */
  | { t: "hello"; now: number; expiresAt: number; ttl: number; n: number; locked: boolean; tag: string; lobby?: true }
  | { t: "kx"; from: string; d: string }
  | { t: "locked"; on: boolean }
  | { t: "melted" }
  | { t: "presence"; n: number }
  | { t: "msg"; iv: string; ct: string }
  | { t: "pong" }
  | { t: "expired" }
  | { t: "error"; code: ErrorCode };
