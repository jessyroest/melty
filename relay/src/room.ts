import { DurableObject } from "cloudflare:workers";
import {
  B64URL_RE,
  CLOSE,
  type ErrorCode,
  GONE_MARGIN_MS,
  inferTtl,
  IV_CHARS,
  MAX_CT_CHARS,
  MAX_FRAME_CHARS,
  MAX_PARTICIPANTS,
  OWNER_RE,
  RATE_BURST,
  RATE_PER_SEC,
} from "./protocol";
import { REJECT_HEADER, send, trySend } from "./ws";

/**
 * Per-socket state. Lives on the socket (survives hibernation), never in storage.
 * `id` is a random per-connection tag used only to skip the sender when relaying.
 * `ttl` (seconds) lets later joiners learn the room's total lifetime without storing it.
 * `owner` (SHA-256 of the creator's secret) and `locked` are room-wide; every socket carries a
 * copy, so they live as long as somebody is connected and are never written to storage.
 */
type Attachment = {
  id: string;
  tokens: number;
  last: number;
  exp: number;
  ttl: number;
  owner?: string;
  locked: boolean;
};

/**
 * One Durable Object per room. It relays ciphertext between sockets and stores
 * nothing but `expiresAt` (and, after expiry, a `goneUntil` tombstone).
 */
export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // keepalive pings are answered by the runtime without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  async fetch(request: Request): Promise<Response> {
    const forced = request.headers.get(REJECT_HEADER);
    if (forced !== null) return this.reject(isErrorCode(forced) ? forced : "bad");

    const url = new URL(request.url);
    const create = url.searchParams.get("create");
    // the worker has validated `owner`: the creator sends the hash of its secret
    const ownerParam = url.searchParams.get("owner") ?? undefined;
    const now = Date.now();
    let creating = false;
    let { expiresAt, goneUntil } = await this.load();

    if (goneUntil !== undefined) {
      if (now < goneUntil) return this.reject("gone");
      await this.ctx.storage.deleteAll();
      expiresAt = undefined;
    }
    if (expiresAt !== undefined && now >= expiresAt) {
      await this.expire(expiresAt);
      return this.reject("gone");
    }
    if (expiresAt === undefined) {
      // joining never creates a room; the worker has already validated `create`
      if (create === null) return this.reject("not_found");
      expiresAt = now + Number(create) * 1000;
      await this.ctx.storage.put("expiresAt", expiresAt);
      await this.ctx.storage.setAlarm(expiresAt);
      creating = true;
    }

    const peers = this.open();
    const room = peers[0]?.deserializeAttachment() as Attachment | null | undefined;
    // only the request that creates the room can set the owner; an empty room has no owner left
    const owner = creating ? ownerParam : room?.owner;
    const locked = room?.locked ?? false;
    if (locked && !(owner !== undefined && ownerParam === owner)) return this.reject("locked");
    if (peers.length >= MAX_PARTICIPANTS) return this.reject("full");
    const ttl = creating ? Number(create) : (room?.ttl ?? inferTtl(expiresAt - now));

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const att: Attachment = {
      id: crypto.randomUUID(),
      tokens: RATE_BURST,
      last: now,
      exp: expiresAt,
      ttl,
      owner,
      locked,
    };
    server.serializeAttachment(att);

    const n = peers.length + 1;
    send(server, { t: "hello", now, expiresAt, ttl, n, locked });
    for (const p of peers) send(p, { t: "presence", n });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return; // a rejected socket
    const now = Date.now();

    if (now >= att.exp) {
      const { expiresAt } = await this.load();
      if (expiresAt !== undefined) await this.expire(expiresAt);
      else ws.close(CLOSE.expired, "room expired");
      return;
    }
    if (typeof message !== "string") {
      send(ws, { t: "error", code: "bad" });
      return;
    }

    // token bucket per connection
    att.tokens = Math.min(RATE_BURST, att.tokens + ((now - att.last) / 1000) * RATE_PER_SEC);
    att.last = now;
    if (att.tokens < 1) {
      ws.serializeAttachment(att);
      send(ws, { t: "error", code: "rate" });
      return;
    }
    att.tokens -= 1;
    ws.serializeAttachment(att);

    if (message.length > MAX_FRAME_CHARS) {
      send(ws, { t: "error", code: "too_big" });
      return;
    }
    const frame = parseFrame(message);
    if (frame === "too_big" || frame === null) {
      send(ws, { t: "error", code: frame ?? "bad" });
      return;
    }
    if (frame.t !== "msg") {
      await this.control(ws, att, frame);
      return;
    }

    // re-serialize so only iv/ct ever leave this object
    const out = JSON.stringify({ t: "msg", iv: frame.iv, ct: frame.ct });
    for (const p of this.open()) {
      if (idOf(p) !== att.id) trySend(p, out);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try {
      ws.close(1000);
    } catch {
      // already closed
    }
    if (!this.ctx.getTags(ws).includes(REJECTED)) this.announcePresence(idOf(ws));
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    if (!this.ctx.getTags(ws).includes(REJECTED)) this.announcePresence(idOf(ws));
  }

  async alarm(): Promise<void> {
    const { expiresAt, goneUntil } = await this.load();
    const now = Date.now();
    if (goneUntil !== undefined) {
      if (now >= goneUntil) await this.ctx.storage.deleteAll();
      else await this.ctx.storage.setAlarm(goneUntil);
      return;
    }
    if (expiresAt === undefined) return;
    if (now >= expiresAt) await this.expire(expiresAt);
    else await this.ctx.storage.setAlarm(expiresAt);
  }

  /** creator-only actions; the proof is checked against the hash the creator registered */
  private async control(ws: WebSocket, att: Attachment, f: Exclude<Frame, { t: "msg" }>): Promise<void> {
    if (att.owner === undefined || (await sha256b64url(f.owner)) !== att.owner) {
      send(ws, { t: "error", code: "bad" });
      return;
    }
    if (f.t === "melt") {
      const { expiresAt } = await this.load();
      await this.expire(expiresAt ?? Date.now(), "melted");
      return;
    }
    for (const p of this.open()) {
      const a = p.deserializeAttachment() as Attachment;
      a.locked = f.on;
      p.serializeAttachment(a);
      send(p, { t: "locked", on: f.on });
    }
  }

  /** Close everyone, wipe everything, keep only a tombstone so the id can't be reused right away. */
  private async expire(expiresAt: number, why: "expired" | "melted" = "expired"): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      send(ws, { t: why });
      try {
        ws.close(CLOSE[why], `room ${why}`);
      } catch {
        // already closed
      }
    }
    await this.ctx.storage.deleteAll();
    const goneUntil = expiresAt + GONE_MARGIN_MS;
    await this.ctx.storage.put("goneUntil", goneUntil);
    await this.ctx.storage.setAlarm(goneUntil);
  }

  /**
   * Accept the upgrade only to tell the browser why, then close: browsers can't
   * read the HTTP status of a failed upgrade. Goes through the hibernation API
   * like every other socket here; a plain `accept()`ed socket that is closed this
   * early makes the runtime report a lost connection.
   */
  private reject(code: ErrorCode): Response {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [REJECTED]);
    send(server, { t: "error", code });
    server.close(CLOSE[code], code);
    return new Response(null, { status: 101, webSocket: client });
  }

  private announcePresence(leavingId: string | undefined): void {
    const rest = this.open().filter((p) => idOf(p) !== leavingId);
    for (const p of rest) send(p, { t: "presence", n: rest.length });
  }

  private open(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN && idOf(ws) !== undefined);
  }

  private async load(): Promise<{ expiresAt?: number; goneUntil?: number }> {
    const m = await this.ctx.storage.get<number>(["expiresAt", "goneUntil"]);
    return { expiresAt: m.get("expiresAt"), goneUntil: m.get("goneUntil") };
  }
}

const REJECTED = "rejected";

function isErrorCode(code: string): code is ErrorCode {
  return code !== "expired" && Object.hasOwn(CLOSE, code);
}

function idOf(ws: WebSocket): string | undefined {
  return (ws.deserializeAttachment() as Attachment | null)?.id;
}

type Frame =
  | { t: "msg"; iv: string; ct: string }
  | { t: "melt"; owner: string }
  | { t: "lock"; owner: string; on: boolean };

function parseFrame(raw: string): Frame | "too_big" | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const { t, iv, ct, owner, on } = v as Record<string, unknown>;
  if (t === "melt" || t === "lock") {
    if (typeof owner !== "string" || !OWNER_RE.test(owner)) return null;
    if (t === "melt") return { t, owner };
    return typeof on === "boolean" ? { t, owner, on } : null;
  }
  if (t !== "msg" || typeof iv !== "string" || typeof ct !== "string") return null;
  if (iv.length !== IV_CHARS || !B64URL_RE.test(iv) || !B64URL_RE.test(ct) || ct.length < 22) return null;
  if (ct.length > MAX_CT_CHARS) return "too_big";
  return { t: "msg", iv, ct };
}

async function sha256b64url(b64url: string): Promise<string> {
  const bin = atob(b64url.replace(/-/g, "+").replace(/_/g, "/") + "=");
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
