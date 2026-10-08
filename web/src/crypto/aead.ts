import { type Bytes, fromB64url, toB64url } from "../lib/b64url";

export type Sealed = { iv: string; ct: string };

const IV_BYTES = 12;

/** AES-256-GCM with a fresh random 96-bit IV per message. */
export async function seal(key: CryptoKey, aad: Bytes, plaintext: Bytes): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, plaintext);
  return { iv: toB64url(iv), ct: toB64url(new Uint8Array(ct)) };
}

/** Throws if the key, IV, AAD or ciphertext don't match. */
export async function open(key: CryptoKey, aad: Bytes, sealed: Sealed): Promise<Bytes> {
  const iv = fromB64url(sealed.iv);
  if (iv.length !== IV_BYTES) throw new Error("bad iv");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    fromB64url(sealed.ct),
  );
  return new Uint8Array(pt);
}
