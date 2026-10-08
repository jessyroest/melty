import { SUBPROTOCOL } from "@relay/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RELAY_URL, RelayConnection, type RelayEvent, relayProtocols } from "./relay";

/** records what RelayConnection hands the browser's WebSocket */
class FakeSocket {
  static last: FakeSocket;
  static readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  constructor(
    readonly url: URL | string,
    readonly protocols?: string | string[],
  ) {
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
}

const ROOM = "A".repeat(43);
const OWNER = "B".repeat(43);

describe("RelayConnection transport", () => {
  beforeEach(() => vi.stubGlobal("WebSocket", FakeSocket));
  afterEach(() => vi.unstubAllGlobals());

  it("connects to the fixed path /ws: no room id, ttl or owner in the URL", () => {
    new RelayConnection(ROOM, 600, OWNER, () => {});
    const url = new URL(String(FakeSocket.last.url));
    expect(url.pathname).toBe("/ws");
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
    expect(url.origin).toBe(new URL(RELAY_URL).origin);
    expect(url.href).not.toContain(ROOM);
    expect(url.href).not.toContain(OWNER);
  });

  it("puts everything in the subprotocol offer, as HTTP tokens", () => {
    new RelayConnection(ROOM, 3600, OWNER, () => {});
    expect(FakeSocket.last.protocols).toEqual([SUBPROTOCOL, `r.${ROOM}`, "c.3600", `o.${OWNER}`]);
    new RelayConnection(ROOM, undefined, undefined, () => {});
    expect(FakeSocket.last.protocols).toEqual([SUBPROTOCOL, `r.${ROOM}`]);
    // RFC 7230 tchar: what browsers accept in Sec-WebSocket-Protocol
    const tchar = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
    for (const p of relayProtocols(ROOM, 86400, OWNER)) expect(p).toMatch(tchar);
  });

  it("reports a socket that never opened as unreachable, and a lost one as closed", () => {
    const events: RelayEvent[] = [];
    new RelayConnection(ROOM, undefined, undefined, (e) => events.push(e));
    FakeSocket.last.onclose!({ code: 1006 });
    expect(events).toEqual([{ type: "unreachable" }]);

    events.length = 0;
    new RelayConnection(ROOM, undefined, undefined, (e) => events.push(e));
    const ws = FakeSocket.last;
    ws.readyState = FakeSocket.OPEN;
    ws.onopen!();
    ws.onclose!({ code: 1006 });
    expect(events).toEqual([{ type: "closed", code: 1006 }]);
  });

  it("sendRaw sends a pre-built frame synchronously, only while open", () => {
    const conn = new RelayConnection(ROOM, undefined, undefined, () => {});
    const ws = FakeSocket.last;
    expect(conn.sendRaw('{"t":"ping"}')).toBe(false);
    expect(ws.sent).toEqual([]);
    ws.readyState = FakeSocket.OPEN;
    ws.onopen!();
    expect(conn.sendRaw('{"t":"msg","iv":"x","ct":"y"}')).toBe(true);
    expect(ws.sent).toEqual(['{"t":"msg","iv":"x","ct":"y"}']);
  });
});
