import {
  type ClientFrame,
  type ErrorCode,
  PROTO_CREATE,
  PROTO_OWNER,
  PROTO_ROOM,
  PROTO_WORDS,
  type ServerFrame,
  SUBPROTOCOL,
  type Ttl,
  WS_PATH,
} from "@relay/protocol";
import type { Sealed } from "../crypto/aead";

export const RELAY_URL: string = import.meta.env.VITE_RELAY_URL ?? "ws://localhost:8787";

export type RelayEvent =
  | { type: "hello"; now: number; expiresAt: number; ttl: number; n: number; locked: boolean; tag: string; lobby: boolean }
  /** a key-exchange frame from the socket tagged `from` */
  | { type: "kx"; from: string; d: string }
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
 * Where a connection goes: a room by id (joining, or creating it with a ttl, the owner hash
 * and its words), or a knock with 4 words, which lands in the room's lobby.
 */
export type Target =
  | { roomId: string; create?: Ttl; owner?: string; words?: string }
  | { knock: string };

/**
 * The subprotocol offer that carries the room: `melty.v1, r.<roomId>[, c.<ttl>][, o.<ownerHash>][, w.<words>]`,
 * or `melty.v1, w.<words>` to knock. It travels in the `Sec-WebSocket-Protocol` header, so nothing
 * about the room is in the URL.
 */
export function relayProtocols(target: Target): string[] {
  if ("knock" in target) return [SUBPROTOCOL, PROTO_WORDS + target.knock];
  const protocols = [SUBPROTOCOL, PROTO_ROOM + target.roomId];
  if (target.create) protocols.push(PROTO_CREATE + String(target.create));
  if (target.owner) protocols.push(PROTO_OWNER + target.owner);
  if (target.create && target.words) protocols.push(PROTO_WORDS + target.words);
  return protocols;
}

/** One WebSocket to the relay. Knows nothing about keys or plaintext. */
export class RelayConnection {
  private ws: WebSocket;
  private ping: ReturnType<typeof setInterval> | undefined;
  private done = false;
  private opened = false;

  /** a create's `owner` is the SHA-256 of the creator's secret; only the creator ever has one */
  constructor(
    target: Target,
    private onEvent: (e: RelayEvent) => void,
  ) {
    // a fixed path; the room id, ttl, owner hash and words go in the subprotocol offer
    this.ws = new WebSocket(new URL(WS_PATH, RELAY_URL), relayProtocols(target));
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

  /** a key-exchange frame, to one socket by tag, or to every member */
  sendKx(to: string | undefined, d: string): boolean {
    if (!this.open) return false;
    const frame: ClientFrame = to === undefined ? { t: "kx", d } : { t: "kx", to, d };
    this.ws.send(JSON.stringify(frame));
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
        return this.onEvent({
          type: "hello",
          now: f.now,
          expiresAt: f.expiresAt,
          ttl: f.ttl,
          n: f.n,
          locked: !!f.locked,
          tag: typeof f.tag === "string" ? f.tag : "",
          lobby: f.lobby === true,
        });
      case "kx":
        if (typeof f.from !== "string" || typeof f.d !== "string") return;
        return this.onEvent({ type: "kx", from: f.from, d: f.d });
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
