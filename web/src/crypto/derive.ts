import { type Bytes, toB64url } from "../lib/b64url";

export const SECRET_BYTES = 32;
export const ROOM_KEY_BYTES = 32;

// The link secret is 32 uniformly random bytes, so HKDF's salt adds nothing; a
// fixed all-zero salt (RFC 5869 default) keeps derivation reproducible.
const SALT = new Uint8Array(32);
const enc = new TextEncoder();

/**
 * What the link (`/r#<linkSecret>`) gives you. Since phase 2 the link no longer
 * carries the room key: it points to the room and proves you were given the link.
 */
export type LinkKeys = {
  /** sent to the relay; identifies the room, reveals nothing about the secret */
  roomId: string;
  /** raw roomId bytes, part of every message's additional data */
  aad: Bytes;
  /** pre-shared key that authenticates the key exchange of a link join; never leaves the browser */
  psk: Bytes;
};

export type RoomKeys = LinkKeys & {
  /** AES-256-GCM, non-extractable; the raw bytes travel only inside the key exchange */
  key: CryptoKey;
};

export function newSecret(): Bytes {
  return crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
}

export async function deriveLink(linkSecret: Bytes): Promise<LinkKeys> {
  if (linkSecret.length !== SECRET_BYTES) throw new Error("secret must be 32 bytes");
  const ikm = await crypto.subtle.importKey("raw", linkSecret, "HKDF", false, ["deriveBits"]);
  const bits = (info: string) =>
    crypto.subtle
      .deriveBits({ name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(info) }, ikm, 256)
      .then((b) => new Uint8Array(b));
  const [aad, psk] = await Promise.all([bits("room-id-v1"), bits("link-psk-v1")]);
  return { roomId: toB64url(aad), aad, psk };
}

/** the room key as a non-extractable AES-256-GCM key */
export async function importRoomKey(raw: Bytes): Promise<CryptoKey> {
  if (raw.length !== ROOM_KEY_BYTES) throw new Error("room key must be 32 bytes");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function deriveRoom(linkSecret: Bytes, roomKey: Bytes): Promise<RoomKeys> {
  const [link, key] = await Promise.all([deriveLink(linkSecret), importRoomKey(roomKey)]);
  return { ...link, key };
}
