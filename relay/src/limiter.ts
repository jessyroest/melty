import { DurableObject } from "cloudflare:workers";
import { CONNECT_BURST, CONNECT_PER_MIN, CREATE_LIMIT_PER_HOUR, WORDS_BURST, WORDS_PER_MIN } from "./protocol";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/**
 * per client: a token bucket for connection attempts, one for knocks with 4 words,
 * and a fixed hourly window for room creations
 */
type Entry = { tokens: number; last: number; words: number; createStart: number; creates: number };

/**
 * Counts connection attempts and room creations per client, in memory only.
 * Keys are HMACs of the IP under a random key that exists only in this
 * instance's memory, so not even the in-memory map holds a raw address.
 * Nothing is ever written to storage; an eviction resets the counters
 * (soft limit, by design).
 */
export class Limiter extends DurableObject<Env> {
  private key: Promise<CryptoKey> | undefined;
  private entries = new Map<string, Entry>();

  /**
   * One connection attempt: a join, a create, or a knock with 4 words.
   * "slow": too many attempts (or too many knocks); "limit": too many new rooms.
   * A refused attempt still uses up a token, a refused creation doesn't count as a creation.
   */
  async admit(ip: string, kind: "join" | "create" | "knock"): Promise<"ok" | "slow" | "limit"> {
    this.key ??= crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]) as Promise<CryptoKey>;
    const mac = await crypto.subtle.sign("HMAC", await this.key, new TextEncoder().encode(ip));
    const k = hex(new Uint8Array(mac, 0, 16));
    const now = Date.now();
    if (this.entries.size > 5000) this.sweep(now);

    let e = this.entries.get(k);
    if (!e) {
      e = { tokens: CONNECT_BURST, last: now, words: WORDS_BURST, createStart: now, creates: 0 };
      this.entries.set(k, e);
    }
    const elapsed = (now - e.last) / MINUTE;
    e.tokens = Math.min(CONNECT_BURST, e.tokens + elapsed * CONNECT_PER_MIN);
    e.words = Math.min(WORDS_BURST, e.words + elapsed * WORDS_PER_MIN);
    e.last = now;
    if (e.tokens < 1) return "slow";
    e.tokens -= 1;

    if (kind === "knock") {
      // guessing words is the attack here: far fewer tries than plain connections
      if (e.words < 1) return "slow";
      e.words -= 1;
      return "ok";
    }
    if (kind !== "create") return "ok";
    if (e.creates === 0 || now - e.createStart >= HOUR) {
      e.createStart = now;
      e.creates = 0;
    }
    if (e.creates >= CREATE_LIMIT_PER_HOUR) return "limit";
    e.creates++;
    return "ok";
  }

  /** drop entries that are back to a clean slate */
  private sweep(now: number): void {
    const refill = Math.max(CONNECT_BURST / CONNECT_PER_MIN, WORDS_BURST / WORDS_PER_MIN) * MINUTE;
    for (const [k, e] of this.entries) {
      if (now - e.last >= refill && (e.creates === 0 || now - e.createStart >= HOUR)) this.entries.delete(k);
    }
  }
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
