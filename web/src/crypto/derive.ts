import { type Bytes, toB64url } from "../lib/b64url";

export const SECRET_BYTES = 32;

// The secret is 32 uniformly random bytes, so HKDF's salt adds nothing; a
// fixed all-zero salt (RFC 5869 default) keeps derivation reproducible.
const SALT = new Uint8Array(32);
const enc = new TextEncoder();

export type RoomKeys = {
  /** sent to the relay; identifies the room, reveals nothing about the secret */
  roomId: string;
  /** raw roomId bytes, used as AES-GCM additional data */
  aad: Bytes;
  /** AES-256-GCM, non-extractable */
  key: CryptoKey;
};

export function newSecret(): Bytes {
  return crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
}

export async function deriveRoom(secret: Bytes): Promise<RoomKeys> {
  if (secret.length !== SECRET_BYTES) throw new Error("secret must be 32 bytes");
  const ikm = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits", "deriveKey"]);
  const aad = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode("room-id-v1") },
      ikm,
      256,
    ),
  );
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode("room-key-v1") },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return { roomId: toB64url(aad), aad, key };
}
