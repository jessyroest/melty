import {
  type ClientFrame,
  type ErrorCode,
  PROTO_CREATE,
  PROTO_OWNER,
  PROTO_ROOM,
  type ServerFrame,
  SUBPROTOCOL,
  type Ttl,
  WS_PATH,
} from "@relay/protocol";
import type { Sealed } from "../crypto/aead";

export const RELAY_URL: string = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:8787";

export type RelayEvent =
  | { type: "hello"; now: number; expiresAt: number; ttl: number; n: number; locked: boolean }
  | { type: "locked"; on: boolean }
  | { type: "melted" }
  | { type: "presence"; n: number }
  | { type: "msg"; sealed: Sealed }
  | { type: "expired" }
  | { type: "error"; code: ErrorCode }
  | { type: "closed"; code: number }
  /** the socket closed without ever opening: handshake refused, network down or relay offline */
  | { type: "unreachable" };

const PING_MS = 30_000;

/**
 * The subprotocol offer that carries the room: `melty.v1, r.<roomId>[, c.<ttl>][, o.<ownerHash>]`.
 * It travels in the `Sec-WebSocket-Protocol` header, so nothing about the room is in the URL.
 */
export function relayProtocols(roomId: string, create?: Ttl, owner?: string): string[] {
  const protocols = [SUBPROTOCOL, PROTO_ROOM + roomId];
  if (create) protocols.push(PROTO_CREATE + String(create));
  if (owner) protocols.push(PROTO_OWNER + owner);
  return protocols;
}

/** One WebSocket to the relay. Knows nothing about keys or plaintext. */
export class RelayConnection {
  private ws: WebSocket;
  private ping: ReturnType<typeof setInterval> | undefined;
  private done = false;
  private opened = false;

  /** `owner` is the SHA-256 of the creator's secret; only the creator ever has one */
  constructor(
    roomId: string,
    create: Ttl | undefined,
    owner: string | undefined,
    private onEvent: (e: RelayEvent) => void,
  ) {
    // a fixed path; the room id, ttl and owner hash go in the subprotocol offer
    this.ws = new WebSocket(new URL(WS_PATH, RELAY_URL), relayProtocols(roomId, create, owner));
    this.ws.onopen = () => {
      this.opened = true;
      this.ping = setInterval(() => this.ws.send('{"t":"ping"}'), PING_MS);
    };
    this.ws.onmessage = (e) => {
      const f = parse(e.data);
      if (f) this.handle(f);
    };
    this.ws.onclose = (e) => {
      clearInterval(this.ping);
      if (!this.done) this.onEvent(this.opened ? { type: "closed", code: e.code } : { type: "unreachable" });
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

  /** send a pre-built frame synchronously, if the socket is open */
  sendRaw(frame: string): boolean {
    if (!this.open) return false;
    this.ws.send(frame);
    return true;
  }

  /** creator-only control frames: they carry no message content */
  control(frame: Extract<ClientFrame, { t: "melt" | "lock" }>): boolean {
    if (!this.open) return false;
    this.ws.send(JSON.stringify(frame));
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
        return this.onEvent({ type: "hello", now: f.now, expiresAt: f.expiresAt, ttl: f.ttl, n: f.n, locked: !!f.locked });
      case "locked":
        return this.onEvent({ type: "locked", on: !!f.on });
      case "melted":
        return this.onEvent({ type: "melted" });
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
