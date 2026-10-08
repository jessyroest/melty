import { describe, expect, it } from "vitest";
import {
  anchorClock,
  backoffMs,
  FIRST_TRIES,
  nextRetry,
  OFFLINE_CAP_MS,
  RETRY_CAP_MS,
  type RetryState,
  serverTime,
} from "./resilience";

describe("backoff schedule", () => {
  it("doubles from ~0.5 s and is capped at 10 s", () => {
    const max = Array.from({ length: 12 }, (_, i) => backoffMs(i, 1));
    expect(max.slice(0, 6)).toEqual([500, 1000, 2000, 4000, 8000, 10_000]);
    expect(max.every((ms) => ms <= RETRY_CAP_MS)).toBe(true);
    expect(backoffMs(1000, 1)).toBe(RETRY_CAP_MS);
  });

  it("jitters within the upper half of each step", () => {
    expect(backoffMs(0, 0)).toBe(250);
    expect(backoffMs(3, 0)).toBe(2000);
    expect(backoffMs(20, 0)).toBe(RETRY_CAP_MS / 2);
    for (let i = 0; i < 200; i++) {
      const attempt = i % 10;
      const ms = backoffMs(attempt);
      expect(ms).toBeGreaterThanOrEqual(backoffMs(attempt, 0));
      expect(ms).toBeLessThanOrEqual(backoffMs(attempt, 1));
    }
  });

  it("is safe with odd inputs", () => {
    expect(backoffMs(-3, 0.5)).toBe(backoffMs(0, 0.5));
    expect(backoffMs(2, 7)).toBe(backoffMs(2, 1));
    expect(backoffMs(2, -1)).toBe(backoffMs(2, 0));
  });
});

describe("retry decisions", () => {
  const live: RetryState = { attempt: 0, everLive: true, expiresAt: 100_000, serverNow: 50_000, downForMs: 0 };

  it("before the first hello: a few quick tries, then unreachable", () => {
    const first = { ...live, everLive: false, expiresAt: null, serverNow: null };
    for (let a = 0; a < FIRST_TRIES; a++) expect(nextRetry({ ...first, attempt: a }).kind).toBe("retry");
    expect(nextRetry({ ...first, attempt: FIRST_TRIES })).toEqual({ kind: "stop", reason: "unreachable" });
  });

  it("after a hello: keeps going no matter how many attempts", () => {
    const d = nextRetry({ ...live, attempt: 500, downForMs: OFFLINE_CAP_MS - 1 }, 1);
    expect(d).toEqual({ kind: "retry", delayMs: RETRY_CAP_MS });
  });

  it("stops when the room has expired by server time", () => {
    expect(nextRetry({ ...live, serverNow: 100_000 })).toEqual({ kind: "stop", reason: "expired" });
    expect(nextRetry({ ...live, serverNow: 99_999 }).kind).toBe("retry");
  });

  it("stops at the offline cap", () => {
    expect(nextRetry({ ...live, downForMs: OFFLINE_CAP_MS })).toEqual({ kind: "stop", reason: "lost" });
  });

  it("expiry wins over the cap", () => {
    expect(nextRetry({ ...live, serverNow: 200_000, downForMs: OFFLINE_CAP_MS * 2 })).toEqual({
      kind: "stop",
      reason: "expired",
    });
  });
});

describe("monotonic server clock", () => {
  it("is the hello time plus monotonic time elapsed", () => {
    const c = anchorClock(1_000_000, 250);
    expect(serverTime(c, 250)).toBe(1_000_000);
    expect(serverTime(c, 1250)).toBe(1_001_000);
  });

  it("doesn't care about the device clock", () => {
    // whatever Date.now() does in between, only the monotonic reading counts
    const c = anchorClock(5_000, 10);
    const before = serverTime(c, 3010);
    expect(before).toBe(8_000);
    expect(serverTime(c, 3010)).toBe(before);
  });
});
