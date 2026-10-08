import { OWNER_RE, PROTO_CREATE, PROTO_OWNER, PROTO_ROOM, ROOM_ID_RE, SUBPROTOCOL, TTL_OPTIONS } from "./protocol";

/** longest legit offer: "melty.v1, r.<43>, c.86400, o.<43>" is about 110 chars */
const MAX_PROTOCOL_HEADER = 256;

export type Offer =
  | { ok: true; roomId: string; create?: number; owner?: string }
  /** a room id we can answer through, but something else is wrong */
  | { ok: false; roomId: string };

/**
 * Strict parse of `Sec-WebSocket-Protocol`: `melty.v1, r.<roomId>[, c.<ttl>][, o.<hash>]`.
 * Returns null when there's no usable room id or the client didn't offer `melty.v1`
 * (we couldn't complete a handshake it accepts).
 */
export function parseOffer(header: string | null): Offer | null {
  if (header === null || header.length > MAX_PROTOCOL_HEADER) return null;
  const parts = header.split(",").map((p) => p.trim());
  if (parts.filter((p) => p === SUBPROTOCOL).length !== 1) return null;
  const rooms = parts.filter((p) => p.startsWith(PROTO_ROOM));
  if (rooms.length !== 1) return null;
  const roomId = rooms[0]!.slice(PROTO_ROOM.length);
  if (!ROOM_ID_RE.test(roomId)) return null;

  const bad = { ok: false, roomId } as const;
  let create: number | undefined;
  let owner: string | undefined;
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
    } else {
      // unknown, empty or repeated entry
      return bad;
    }
  }
  return { ok: true, roomId, create, owner };
}
