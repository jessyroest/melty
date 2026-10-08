import { DurableObject } from "cloudflare:workers";
import { CREATE_LIMIT_PER_HOUR } from "./protocol";

const HOUR = 60 * 60 * 1000;

/**
 * Counts room creations per client, in memory only. Keys are HMACs of the IP
 * under a random key that exists only in this instance's memory, so not even
 * the in-memory map holds a raw address. Nothing is ever written to storage;
 * an eviction resets the counters (soft limit, by design).
 */
export class Limiter extends DurableObject<Env> {
  private key: Promise<CryptoKey> | undefined;
  private windows = new Map<string, { start: number; count: number }>();

  async hit(ip: string): Promise<boolean> {
    this.key ??= crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]) as Promise<CryptoKey>;
    const mac = await crypto.subtle.sign("HMAC", await this.key, new TextEncoder().encode(ip));
    const k = hex(new Uint8Array(mac, 0, 16));
    const now = Date.now();
    if (this.windows.size > 5000) this.sweep(now);

    const w = this.windows.get(k);
    if (!w || now - w.start >= HOUR) {
      this.windows.set(k, { start: now, count: 1 });
      return true;
    }
    if (w.count >= CREATE_LIMIT_PER_HOUR) return false;
    w.count++;
    return true;
  }

  private sweep(now: number): void {
    for (const [k, w] of this.windows) if (now - w.start >= HOUR) this.windows.delete(k);
  }
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
