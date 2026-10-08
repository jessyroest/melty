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
  RATE_BURST,
  RATE_PER_SEC,
} from "./protocol";
import { REJECT_HEADER, send, trySend } from "./ws";

/**
 * Per-socket state. Lives on the socket (survives hibernation), never in storage.
 * `id` is a random per-connection tag used only to skip the sender when relaying.
 * `ttl` (seconds) lets later joiners learn the room's total lifetime without storing it.
 */
type Attachment = { id: string; tokens: number; last: number; exp: number; ttl: number };

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

    const create = new URL(request.url).searchParams.get("create");
    const now = Date.now();
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
    }

    const peers = this.open();
    if (peers.length >= MAX_PARTICIPANTS) return this.reject("full");
    const ttl =
      create !== null && peers.length === 0
        ? Number(create)
        : ((peers[0]?.deserializeAttachment() as Attachment | null)?.ttl ?? inferTtl(expiresAt - now));

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const att: Attachment = { id: crypto.randomUUID(), tokens: RATE_BURST, last: now, exp: expiresAt, ttl };
    server.serializeAttachment(att);

    const n = peers.length + 1;
    send(server, { t: "hello", now, expiresAt, ttl, n });
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
    const frame = parseMsg(message);
    if (frame === "too_big" || frame === null) {
      send(ws, { t: "error", code: frame ?? "bad" });
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

  /** Close everyone, wipe everything, keep only a tombstone so the id can't be reused right away. */
  private async expire(expiresAt: number): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      send(ws, { t: "expired" });
      try {
        ws.close(CLOSE.expired, "room expired");
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

function parseMsg(raw: string): { iv: string; ct: string } | "too_big" | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const { t, iv, ct } = v as Record<string, unknown>;
  if (t !== "msg" || typeof iv !== "string" || typeof ct !== "string") return null;
  if (iv.length !== IV_CHARS || !B64URL_RE.test(iv) || !B64URL_RE.test(ct) || ct.length < 22) return null;
  if (ct.length > MAX_CT_CHARS) return "too_big";
  return { iv, ct };
}
