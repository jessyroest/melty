import {
  OWNER_RE,
  parseWordsEntry,
  PROTO_CREATE,
  PROTO_OWNER,
  PROTO_ROOM,
  PROTO_WORDS,
  ROOM_ID_RE,
  SUBPROTOCOL,
  TTL_OPTIONS,
} from "./protocol";

/** longest legit offer: "melty.v1, r.<43>, c.86400, o.<43>, w.1295-1295-1295-1295" is about 135 chars */
const MAX_PROTOCOL_HEADER = 256;

export type Offer =
  | { ok: true; kind: "room"; roomId: string; create?: number; owner?: string; words?: string }
  /** knocking with 4 words: no room id, the relay looks it up */
  | { ok: true; kind: "knock"; words: string }
  /** a room id we can answer through, but something else is wrong */
  | { ok: false; roomId: string };

/**
 * Strict parse of `Sec-WebSocket-Protocol`. Two shapes:
 *   melty.v1, r.<roomId>[, c.<ttl>][, o.<hash>][, w.<words>]   join or create (words only on a create)
 *   melty.v1, w.<words>                                          knock with 4 words
 * Returns null when there's nothing to answer through or the client didn't offer
 * `melty.v1` (we couldn't complete a handshake it accepts).
 */
export function parseOffer(header: string | null): Offer | null {
  if (header === null || header.length > MAX_PROTOCOL_HEADER) return null;
  const parts = header.split(",").map((p) => p.trim());
  if (parts.filter((p) => p === SUBPROTOCOL).length !== 1) return null;
  const rooms = parts.filter((p) => p.startsWith(PROTO_ROOM));

  if (rooms.length === 0) {
    // a knock: exactly `melty.v1, w.<words>`, nothing else
    if (parts.length !== 2) return null;
    const w = parts.find((p) => p.startsWith(PROTO_WORDS));
    const words = w === undefined ? null : parseWordsEntry(w.slice(PROTO_WORDS.length));
    return words === null ? null : { ok: true, kind: "knock", words };
  }

  if (rooms.length !== 1) return null;
  const roomId = rooms[0]!.slice(PROTO_ROOM.length);
  if (!ROOM_ID_RE.test(roomId)) return null;

  const bad = { ok: false, roomId } as const;
  let create: number | undefined;
  let owner: string | undefined;
  let words: string | undefined;
  for (const p of parts) {
    if (p === SUBPROTOCOL || p.startsWith(PROTO_ROOM)) continue;
    if (p.startsWith(PROTO_CREATE) && create === undefined) {
      const v = p.slice(PROTO_CREATE.length);
      // canonical spelling only: "600", not "0600" or "6e2"
      if (!TTL_OPTIONS.some((t) => String(t) === v)) return bad;
      create = Number(v);
    } else if (p.startsWith(PROTO_OWNER) && owner === undefined) {
      const v = p.slice(PROTO_OWNER.length);
      if (!OWNER_RE.test(v)) return bad;
      owner = v;
    } else if (p.startsWith(PROTO_WORDS) && words === undefined) {
      const v = parseWordsEntry(p.slice(PROTO_WORDS.length));
      if (v === null) return bad;
      words = v;
    } else {
      // unknown, empty or repeated entry
      return bad;
    }
  }
  // words are registered by the create, never attached to a plain join
  if (words !== undefined && create === undefined) return bad;
  return { ok: true, kind: "room", roomId, create, owner, words };
}
