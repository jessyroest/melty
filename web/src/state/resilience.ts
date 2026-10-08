/**
 * Pure helpers for staying in a room through real life: phones that sleep,
 * wifi that switches, clocks that jump. No DOM, no state; session.ts wires them up.
 */

/** reconnect delays grow from ~0.5 s and stop growing here */
export const RETRY_CAP_MS = 10_000;
const RETRY_BASE_MS = 500;
/** connection attempts before the first hello; after that the relay counts as unreachable */
export const FIRST_TRIES = 4;
/**
 * The hard cap: once a room has been live, keep retrying until it expires or until
 * the connection has been gone this long, whichever comes first. Then the key is wiped.
 */
export const OFFLINE_CAP_MS = 10 * 60_000;

/**
 * Exponential backoff with "equal jitter": half of the step is fixed, half random,
 * so a room full of phones coming back at once doesn't reconnect in lockstep.
 * attempt 0 → 250–500 ms, 1 → 0.5–1 s, 2 → 1–2 s, … capped at 5–10 s.
 */
export function backoffMs(attempt: number, rand: number = Math.random()): number {
  const step = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt));
  const r = Math.min(1, Math.max(0, rand));
  return Math.round(step / 2 + (step / 2) * r);
}

export type RetryState = {
  /** attempts made since the connection was last live */
  attempt: number;
  /** has this tab ever had a hello for this room? */
  everLive: boolean;
  /** server-clock expiry, once known */
  expiresAt: number | null;
  /** current server time, if there is a clock (see ServerClock) */
  serverNow: number | null;
  /** how long the connection has been gone, ms (monotonic) */
  downForMs: number;
};

export type RetryDecision =
  | { kind: "retry"; delayMs: number }
  /** expired: the room is over by server time. lost: hit the hard cap. unreachable: never got in. */
  | { kind: "stop"; reason: "expired" | "lost" | "unreachable" };

export function nextRetry(s: RetryState, rand: number = Math.random()): RetryDecision {
  if (!s.everLive) {
    return s.attempt >= FIRST_TRIES
      ? { kind: "stop", reason: "unreachable" }
      : { kind: "retry", delayMs: backoffMs(s.attempt, rand) };
  }
  if (s.expiresAt !== null && s.serverNow !== null && s.serverNow >= s.expiresAt) {
    return { kind: "stop", reason: "expired" };
  }
  if (s.downForMs >= OFFLINE_CAP_MS) return { kind: "stop", reason: "lost" };
  return { kind: "retry", delayMs: backoffMs(s.attempt, rand) };
}

/**
 * Server time from a monotonic clock. At hello we note the server's `now` and
 * `performance.now()`; after that, server time is that `now` plus the monotonic
 * time elapsed. Changing the device clock (by hand or NTP) doesn't move it.
 */
export type ServerClock = { serverAt: number; perfAt: number };

export function anchorClock(serverNow: number, perfNow: number): ServerClock {
  return { serverAt: serverNow, perfAt: perfNow };
}

export function serverTime(c: ServerClock, perfNow: number): number {
  return c.serverAt + (perfNow - c.perfAt);
}
