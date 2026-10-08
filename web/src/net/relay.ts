import type { ErrorCode, ServerFrame, Ttl } from "@relay/protocol";
import type { Sealed } from "../crypto/aead";

export const RELAY_URL: string = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:8787";

export type RelayEvent =
  | { type: "hello"; now: number; expiresAt: number; ttl: number; n: number }
  | { type: "presence"; n: number }
  | { type: "msg"; sealed: Sealed }
  | { type: "expired" }
  | { type: "error"; code: ErrorCode }
  | { type: "closed"; code: number };

const PING_MS = 30_000;

/** One WebSocket to the relay. Knows nothing about keys or plaintext. */
export class RelayConnection {
  private ws: WebSocket;
  private ping: ReturnType<typeof setInterval> | undefined;
  private done = false;

  constructor(roomId: string, create: Ttl | undefined, private onEvent: (e: RelayEvent) => void) {
    const url = new URL(`/rooms/${roomId}/ws`, RELAY_URL);
    if (create) url.searchParams.set("create", String(create));
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.ping = setInterval(() => this.ws.send('{"t":"ping"}'), PING_MS);
    };
    this.ws.onmessage = (e) => {
      const f = parse(e.data);
      if (f) this.handle(f);
    };
    this.ws.onclose = (e) => {
      clearInterval(this.ping);
      if (!this.done) this.onEvent({ type: "closed", code: e.code });
      this.done = true;
    };
  }

  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(sealed: Sealed): boolean {
    if (!this.open) return false;
    this.ws.send(JSON.stringify({ t: "msg", iv: sealed.iv, ct: sealed.ct }));
    return true;
  }

  /** close without reporting back */
  close(): void {
    this.done = true;
    clearInterval(this.ping);
    this.ws.onmessage = null;
    try {
      this.ws.close(1000);
    } catch {
      // already closed
    }
  }

  private handle(f: ServerFrame): void {
    switch (f.t) {
      case "hello":
        return this.onEvent({ type: "hello", now: f.now, expiresAt: f.expiresAt, ttl: f.ttl, n: f.n });
      case "presence":
        return this.onEvent({ type: "presence", n: f.n });
      case "msg":
        return this.onEvent({ type: "msg", sealed: { iv: f.iv, ct: f.ct } });
      case "expired":
        return this.onEvent({ type: "expired" });
      case "error":
        return this.onEvent({ type: "error", code: f.code });
    }
  }
}

function parse(data: unknown): ServerFrame | null {
  if (typeof data !== "string") return null;
  try {
    const f = JSON.parse(data) as ServerFrame;
    return typeof f === "object" && f !== null && typeof f.t === "string" ? f : null;
  } catch {
    return null;
  }
}
