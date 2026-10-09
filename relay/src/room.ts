import { DurableObject } from "cloudflare:workers";
import { doorName } from "./door";
import {
  B64URL_RE,
  CLOSE,
  CT_CHARS,
  type ErrorCode,
  GONE_MARGIN_MS,
  inferTtl,
  isErrorCode,
  IV_CHARS,
  LOBBY_MS,
  MAX_CT_CHARS,
  MAX_FRAME_CHARS,
  MAX_KX_CHARS,
  MAX_LOBBY,
  MAX_PARTICIPANTS,
  OWNER_RE,
  RATE_BURST,
  RATE_PER_SEC,
  ROOM_BURST,
  ROOM_RATE_PER_SEC,
  TAG_RE,
} from "./protocol";
import {
  CREATE_HEADER,
  LOBBY_HEADER,
  OWNER_HEADER,
  REJECT_HEADER,
  REJECTED,
  rejectSocket,
  ROOM_HEADER,
  send,
  trySend,
  upgraded,
  WORDS_HEADER,
} from "./ws";

/**
 * Per-socket state. Lives on the socket (survives hibernation), never in storage.
 * `id` is a random per-connection tag: it skips the sender when relaying, and
 * addresses key-exchange frames. It's told to the socket in its hello.
 * `ttl` (seconds) lets later joiners learn the room's total lifetime without storing it.
 * `owner` (SHA-256 of the creator's secret) and `locked` are room-wide; every socket carries a
 * copy. They are also kept in storage (see Room) so they survive an empty room, but the copy on
 * the sockets is what the checks read while anybody is connected.
 * `lobby`: knocked with 4 words and hasn't been let in. It can only exchange key-exchange
 * frames with members, never sees room traffic, and doesn't count as a person.
 */
type Attachment = {
  id: string;
  tokens: number;
  last: number;
  exp: number;
  ttl: number;
  owner?: string;
  locked: boolean;
  lobby?: true;
  since: number;
};

/**
 * One Durable Object per room. It relays ciphertext between sockets and stores only:
 * `expiresAt`; `owner`, the SHA-256 of the creator's owner secret (a hash, never the secret),
 * written once by the creating request; `locked`, present only while the room is locked,
 * written only after a verified creator frame; and, after expiry, a `goneUntil` tombstone.
 * `expire()` runs `deleteAll()`, so owner and locked go with the room.
 */
export class Room extends DurableObject<Env> {
  /**
   * The room's message budget, shared by every socket. Memory only, never stored:
   * hibernation or eviction resets it to a full bucket, which costs nothing, because
   * the object only hibernates after a quiet spell long enough to refill it anyway.
   */
  private budget = ROOM_BURST;
  private budgetAt = Date.now();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // keepalive pings are answered by the runtime without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  async fetch(request: Request): Promise<Response> {
    const forced = request.headers.get(REJECT_HEADER);
    if (forced !== null) return this.reject(isErrorCode(forced) ? forced : "bad");

    // set (and validated) by the worker only, from the client's subprotocol offer
    const create = request.headers.get(CREATE_HEADER);
    const words = request.headers.get(WORDS_HEADER);
    const knocking = request.headers.get(LOBBY_HEADER) !== null;
    // the creator sends the hash of its secret
    const ownerParam = request.headers.get(OWNER_HEADER) ?? undefined;
    const now = Date.now();
    let creating = false;
    const loaded = await this.load();
    const goneUntil = loaded.goneUntil;
    let expiresAt = loaded.expiresAt;

    if (goneUntil !== undefined) {
      if (now < goneUntil) return this.reject(create === null ? "gone" : "taken");
      await this.ctx.storage.deleteAll();
      expiresAt = undefined;
      loaded.owner = undefined;
      loaded.locked = false;
    }
    if (expiresAt !== undefined && now >= expiresAt) {
      await this.expire(expiresAt);
      return this.reject(create === null ? "gone" : "taken");
    }
    if (expiresAt === undefined) {
      // joining never creates a room; the worker has already validated `create`
      if (create === null || knocking) return this.reject("not_found");
      expiresAt = now + Number(create) * 1000;
      // the words have to be free before the room exists
      if (words !== null) {
        const door = this.env.DOOR.get(this.env.DOOR.idFromName(doorName(words)));
        if (!(await door.claim(request.headers.get(ROOM_HEADER) ?? "", expiresAt))) return this.reject("taken");
      }
      await this.ctx.storage.put("expiresAt", expiresAt);
      // written only here, by the creating request, and never overwritten: later requests only read it
      if (ownerParam !== undefined) await this.ctx.storage.put("owner", ownerParam);
      await this.ctx.storage.setAlarm(expiresAt);
      creating = true;
    }

    const peers = this.open();
    const room = (peers[0] ?? this.lobby()[0])?.deserializeAttachment() as Attachment | null | undefined;
    // the sockets' copy while anybody is connected, else what the creating request stored
    const roomOwner = room?.owner ?? loaded.owner;
    // a create for a room that already exists is a collision or an attempt to hijack it,
    // unless it's the creator retrying a create whose hello never arrived
    if (create !== null && !creating && !(ownerParam !== undefined && roomOwner === ownerParam)) return this.reject("taken");
    // only the request that creates the room can set the owner; everyone else inherits the stored one
    const owner = creating ? ownerParam : roomOwner;
    const locked = creating ? false : (room?.locked ?? loaded.locked);
    if (locked && !(owner !== undefined && ownerParam === owner && !knocking)) return this.reject("locked");
    if (peers.length >= MAX_PARTICIPANTS) return this.reject("full");
    if (knocking) {
      // nobody inside can let anyone in; and only a few knockers at a time
      if (peers.length === 0) return this.reject("not_found");
      this.sweepLobby(now);
      if (this.lobby().length >= MAX_LOBBY) return this.reject("full");
    }
    const ttl = creating ? Number(create) : (room?.ttl ?? inferTtl(expiresAt - now));

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server!);
    const att: Attachment = {
      id: newTag(),
      tokens: RATE_BURST,
      last: now,
      exp: expiresAt,
      ttl,
      owner,
      locked,
      since: now,
      ...(knocking ? { lobby: true as const } : {}),
    };
    server!.serializeAttachment(att);

    if (knocking) {
      send(server!, { t: "hello", now, expiresAt, ttl, n: peers.length, locked, tag: att.id, lobby: true });
    } else {
      const n = peers.length + 1;
      send(server!, { t: "hello", now, expiresAt, ttl, n, locked, tag: att.id });
      for (const p of peers) send(p, { t: "presence", n });
    }
    return upgraded(client!);
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
    if (att.lobby && now - att.since >= LOBBY_MS) {
      closeQuietly(ws, CLOSE.timeout, "nobody let you in");
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

    // and the room's shared budget: many sockets each under their own limit can't add up to a flood
    this.budget = Math.min(ROOM_BURST, this.budget + ((now - this.budgetAt) / 1000) * ROOM_RATE_PER_SEC);
    this.budgetAt = now;
    if (this.budget < 1) {
      send(ws, { t: "error", code: "rate" });
      return;
    }
    this.budget -= 1;

    if (message.length > MAX_FRAME_CHARS) {
      send(ws, { t: "error", code: "too_big" });
      return;
    }
    const frame = parseFrame(message);
    if (frame === "too_big" || frame === null) {
      send(ws, { t: "error", code: frame ?? "bad" });
      return;
    }
    if (frame.t === "kx") {
      this.relayKx(ws, att, frame);
      return;
    }
    // a knocker can only do the key exchange
    if (att.lobby) {
      send(ws, { t: "error", code: "bad" });
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
    closeQuietly(ws, 1000);
    this.left(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.left(ws);
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

  /**
   * Key-exchange frames. Without `to` they go to every member (a member's to the others,
   * a knocker's to everyone inside). With `to` they go to that one socket; a knocker can
   * only address members. The relay adds `from`, so the answer can find its way back.
   */
  private relayKx(ws: WebSocket, att: Attachment, f: Extract<Frame, { t: "kx" }>): void {
    const out = JSON.stringify({ t: "kx", from: att.id, d: f.d });
    if (f.to === undefined) {
      for (const p of this.open()) if (idOf(p) !== att.id) trySend(p, out);
      return;
    }
    if (f.to === att.id) return;
    const pool = att.lobby ? this.open() : [...this.open(), ...this.lobby()];
    const target = pool.find((p) => idOf(p) === f.to);
    if (target) trySend(target, out);
  }

  /** creator-only actions; the proof is checked against the hash the creator registered */
  private async control(ws: WebSocket, att: Attachment, f: Extract<Frame, { t: "melt" | "lock" }>): Promise<void> {
    if (att.owner === undefined || (await sha256b64url(f.owner)) !== att.owner) {
      send(ws, { t: "error", code: "bad" });
      return;
    }
    if (f.t === "melt") {
      const { expiresAt } = await this.load();
      await this.expire(expiresAt ?? Date.now(), "melted");
      return;
    }
    if (f.on) await this.ctx.storage.put("locked", true);
    else await this.ctx.storage.delete("locked");
    for (const p of [...this.open(), ...this.lobby()]) {
      const a = p.deserializeAttachment() as Attachment;
      a.locked = f.on;
      p.serializeAttachment(a);
      if (a.lobby) {
        // a locked door sends knockers away
        if (f.on) {
          send(p, { t: "error", code: "locked" });
          closeQuietly(p, CLOSE.locked, "locked");
        }
      } else send(p, { t: "locked", on: f.on });
    }
  }

  /** Close everyone, wipe everything, keep only a tombstone so the id can't be reused right away. */
  private async expire(expiresAt: number, why: "expired" | "melted" = "expired"): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      send(ws, { t: why });
      closeQuietly(ws, CLOSE[why], `room ${why}`);
    }
    await this.ctx.storage.deleteAll();
    const goneUntil = expiresAt + GONE_MARGIN_MS;
    await this.ctx.storage.put("goneUntil", goneUntil);
    await this.ctx.storage.setAlarm(goneUntil);
  }

  private reject(code: ErrorCode): Response {
    return rejectSocket(this.ctx, code);
  }

  /** a socket went away: members hear the new count; when the last member leaves, knockers go too */
  private left(ws: WebSocket): void {
    if (this.ctx.getTags(ws).includes(REJECTED)) return;
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att || att.lobby) return;
    const rest = this.open().filter((p) => idOf(p) !== att.id);
    for (const p of rest) send(p, { t: "presence", n: rest.length });
    if (rest.length === 0) {
      for (const p of this.lobby()) {
        send(p, { t: "error", code: "not_found" });
        closeQuietly(p, CLOSE.not_found, "nobody inside");
      }
    }
  }

  private sweepLobby(now: number): void {
    for (const p of this.lobby()) {
      const a = p.deserializeAttachment() as Attachment;
      if (now - a.since >= LOBBY_MS) closeQuietly(p, CLOSE.timeout, "nobody let you in");
    }
  }

  /** members: open sockets that aren't knocking */
  private open(): WebSocket[] {
    return this.live().filter((ws) => !(ws.deserializeAttachment() as Attachment).lobby);
  }

  private lobby(): WebSocket[] {
    return this.live().filter((ws) => (ws.deserializeAttachment() as Attachment).lobby);
  }

  private live(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN && idOf(ws) !== undefined);
  }

  private async load(): Promise<{ expiresAt?: number; goneUntil?: number; owner?: string; locked: boolean }> {
    const m = await this.ctx.storage.get<number | string | boolean>(["expiresAt", "goneUntil", "owner", "locked"]);
    return {
      expiresAt: m.get("expiresAt") as number | undefined,
      goneUntil: m.get("goneUntil") as number | undefined,
      owner: m.get("owner") as string | undefined,
      locked: m.get("locked") === true,
    };
  }
}

function newTag(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function closeQuietly(ws: WebSocket, code: number, reason?: string): void {
  try {
    ws.close(code, reason);
  } catch {
    // already closed
  }
}

function idOf(ws: WebSocket): string | undefined {
  return (ws.deserializeAttachment() as Attachment | null)?.id;
}

type Frame =
  | { t: "msg"; iv: string; ct: string }
  | { t: "kx"; to?: string; d: string }
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
  const { t, iv, ct, owner, on, to, d } = v as Record<string, unknown>;
  if (t === "melt" || t === "lock") {
    if (typeof owner !== "string" || !OWNER_RE.test(owner)) return null;
    if (t === "melt") return { t, owner };
    return typeof on === "boolean" ? { t, owner, on } : null;
  }
  if (t === "kx") {
    if (typeof d !== "string" || d.length === 0 || !B64URL_RE.test(d)) return null;
    if (d.length > MAX_KX_CHARS) return "too_big";
    if (to === undefined) return { t, d };
    return typeof to === "string" && TAG_RE.test(to) ? { t, to, d } : null;
  }
  if (t !== "msg" || typeof iv !== "string" || typeof ct !== "string") return null;
  if (iv.length !== IV_CHARS || !B64URL_RE.test(iv) || !B64URL_RE.test(ct)) return null;
  if (ct.length > MAX_CT_CHARS) return "too_big";
  // padded to fixed sizes: any other length isn't one of ours
  if (!CT_CHARS.includes(ct.length)) return null;
  return { t: "msg", iv, ct };
}

async function sha256b64url(b64url: string): Promise<string> {
  const bin = atob(b64url.replace(/-/g, "+").replace(/_/g, "/") + "=");
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
