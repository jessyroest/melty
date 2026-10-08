import { DurableObject } from "cloudflare:workers";
import { CONNECT_BURST, CONNECT_PER_MIN, CREATE_LIMIT_PER_HOUR } from "./protocol";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** per client: a token bucket for connection attempts and a fixed hourly window for room creations */
type Entry = { tokens: number; last: number; createStart: number; creates: number };

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
   * One connection attempt (`creating`: it also wants to create a room).
   * "slow": too many attempts; "limit": too many new rooms. A refused attempt
   * still uses up a token, a refused creation doesn't count as a creation.
   */
  async admit(ip: string, creating: boolean): Promise<"ok" | "slow" | "limit"> {
    this.key ??= crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]) as Promise<CryptoKey>;
    const mac = await crypto.subtle.sign("HMAC", await this.key, new TextEncoder().encode(ip));
    const k = hex(new Uint8Array(mac, 0, 16));
    const now = Date.now();
    if (this.entries.size > 5000) this.sweep(now);

    let e = this.entries.get(k);
    if (!e) {
      e = { tokens: CONNECT_BURST, last: now, createStart: now, creates: 0 };
      this.entries.set(k, e);
    }
    e.tokens = Math.min(CONNECT_BURST, e.tokens + ((now - e.last) / MINUTE) * CONNECT_PER_MIN);
    e.last = now;
    if (e.tokens < 1) return "slow";
    e.tokens -= 1;

    if (!creating) return "ok";
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
    const refill = (CONNECT_BURST / CONNECT_PER_MIN) * MINUTE;
    for (const [k, e] of this.entries) {
      if (now - e.last >= refill && (e.creates === 0 || now - e.createStart >= HOUR)) this.entries.delete(k);
    }
  }
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
