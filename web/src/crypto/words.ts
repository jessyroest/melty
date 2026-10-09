import { WORDS } from "./wordlist";

/** a room's door code: 4 word indices into the EFF short list (1296^4 ≈ 2^41) */
export type DoorCode = readonly [number, number, number, number];

export const CODE_WORDS = 4;
export const SAFETY_WORDS = 6;

const INDEX = new Map(WORDS.map((w, i) => [w, i]));

/** uniform in [0, n) without modulo bias */
function randomBelow(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % n;
  }
}

export function newDoorCode(): DoorCode {
  return [randomBelow(WORDS.length), randomBelow(WORDS.length), randomBelow(WORDS.length), randomBelow(WORDS.length)];
}

export function codeWords(code: DoorCode): string[] {
  return code.map((i) => WORDS[i]!);
}

/** what the relay sees: `12-345-6-1295` (indices, not words, so the list's one hyphenated word can't confuse it) */
export function codeToWire(code: DoorCode): string {
  return code.join("-");
}

/**
 * Read 4 words typed by a person: any case, separated by spaces, commas, dots or hyphens.
 * Returns null unless it is exactly 4 words from the list.
 */
export function parseDoorCode(input: string): DoorCode | null {
  const parts = input
    .toLowerCase()
    .normalize("NFKC")
    .split(/[\s,.;·/-]+/)
    .filter(Boolean);
  // "yo-yo" is the list's only hyphenated word, and "yo" alone isn't a word
  const tokens: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "yo" && parts[i + 1] === "yo") {
      tokens.push("yo-yo");
      i++;
    } else tokens.push(parts[i]!);
  }
  if (tokens.length !== CODE_WORDS) return null;
  const idx = tokens.map((t) => INDEX.get(t));
  if (idx.some((i) => i === undefined)) return null;
  return idx as unknown as DoorCode;
}

/** does this look like an attempt at words rather than a link? */
export function looksLikeWords(input: string): boolean {
  return /^[\sa-zA-Z,.;·/-]+$/.test(input.trim()) && !input.includes("/r");
}

/** 6 words from the first bytes of a hash: 6 × log2(1296) ≈ 62 bits */
export function safetyWords(hash: Uint8Array): string[] {
  if (hash.length < 8) throw new Error("hash too short");
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(hash[i]!);
  const out: string[] = [];
  const base = BigInt(WORDS.length);
  for (let i = 0; i < SAFETY_WORDS; i++) {
    out.push(WORDS[Number(n % base)]!);
    n /= base;
  }
  return out;
}
