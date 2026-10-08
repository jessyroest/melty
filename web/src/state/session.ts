import type { ErrorCode, Ttl } from "@relay/protocol";
import { useSyncExternalStore } from "react";
import { open, seal } from "../crypto/aead";
import { deriveRoom, newSecret, type RoomKeys, SECRET_BYTES } from "../crypto/derive";
import { cleanNick, decodeInner, encodeInner, type Inner, TooLarge } from "../crypto/message";
import { type Bytes, fromB64url, toB64url } from "../lib/b64url";
import { randomNick } from "../lib/nick";
import { navigate } from "../lib/router";
import { RelayConnection, type RelayEvent } from "../net/relay";

export type Line = { id: number; kind: "chat" | "system"; mine: boolean; nick: string; text: string; ts: number };
export type Status = "connecting" | "live" | "reconnecting";

export type View = {
  status: Status;
  lines: Line[];
  /** people connected, according to the relay */
  n: number;
  /** server-clock expiry and total lifetime, known after hello */
  expiresAt: number | null;
  ttlMs: number | null;
  /** serverNow - localNow */
  offset: number;
  nick: string;
  isCreator: boolean;
  hint: string | null;
};

export const MELTED = "that room melted. everything's gone.";

const MAX_LINES = 500;
const MAX_RETRIES = 3;

const FATAL: Partial<Record<ErrorCode, string>> = {
  not_found: "that room doesn't exist, or it already melted.",
  gone: "that room already melted.",
  full: "that room is full. 8 people max.",
  limit: "too many new rooms from your network. try again in a while.",
};

/**
 * Everything about the current room lives here, in memory only: the secret,
 * the derived key, the messages. `wipe()` drops all of it.
 */
class Session {
  view: View;
  private secret: Bytes | null;
  private keys: RoomKeys | null;
  private conn: RelayConnection | null = null;
  private joined = false;
  private ended = false;
  private retries = 0;
  private nextId = 1;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(secret: Bytes, keys: RoomKeys, isCreator: boolean) {
    this.secret = secret;
    this.keys = keys;
    this.view = {
      status: "connecting",
      lines: [],
      n: 0,
      expiresAt: null,
      ttlMs: null,
      offset: 0,
      nick: randomNick(),
      isCreator,
      hint: null,
    };
  }

  connect(create?: Ttl): void {
    if (!this.keys) return;
    this.conn = new RelayConnection(this.keys.roomId, create, (e) => void this.onEvent(e));
  }

  shareLink(): string | null {
    return this.secret ? `${location.origin}/r#${toB64url(this.secret)}` : null;
  }

  async send(raw: string): Promise<boolean> {
    const text = raw.trim();
    if (!text) return false;
    const m: Inner = { v: 1, kind: "chat", nick: this.view.nick, text, ts: Date.now() };
    try {
      if (!(await this.transmit(m))) {
        this.flash("not connected right now.");
        return false;
      }
    } catch (e) {
      if (e instanceof TooLarge) this.flash("too long. keep it under 4 KB.");
      return false;
    }
    this.push({ kind: "chat", mine: true, nick: m.nick, text, ts: m.ts });
    return true;
  }

  async setNick(raw: string): Promise<void> {
    const nick = cleanNick(raw);
    if (!nick || nick === this.view.nick) return;
    const prev = this.view.nick;
    this.update({ nick });
    await this.transmit({ v: 1, kind: "nick", nick, prev, ts: Date.now() }).catch(() => false);
    this.push({ kind: "system", mine: true, nick, text: `you're ${nick} now`, ts: Date.now() });
  }

  /** say goodbye (best effort), then wipe */
  async leave(notice: string | null): Promise<void> {
    if (this.ended) return;
    await this.transmit({ v: 1, kind: "leave", nick: this.view.nick, ts: Date.now() }).catch(() => false);
    this.end(notice);
  }

  end(notice: string | null): void {
    if (this.ended) return;
    this.ended = true;
    this.wipe();
    if (store.session === this) {
      store = { session: null, notice };
      emit();
      if (location.pathname === "/r") navigate("/", { replace: true });
    }
  }

  private wipe(): void {
    this.secret?.fill(0);
    this.secret = null;
    this.keys = null;
    this.conn?.close();
    this.conn = null;
    clearTimeout(this.expiryTimer);
    clearTimeout(this.hintTimer);
    clearTimeout(this.retryTimer);
    this.view = { ...this.view, lines: [], nick: "", hint: null };
  }

  private async transmit(m: Inner): Promise<boolean> {
    if (!this.keys || !this.conn?.open) return false;
    const sealed = await seal(this.keys.key, this.keys.aad, encodeInner(m));
    return this.conn?.send(sealed) ?? false;
  }

  private async onEvent(e: RelayEvent): Promise<void> {
    if (this.ended) return;
    switch (e.type) {
      case "hello": {
        this.retries = 0;
        this.update({
          status: "live",
          n: e.n,
          expiresAt: e.expiresAt,
          ttlMs: e.ttl * 1000,
          offset: e.now - Date.now(),
        });
        this.scheduleExpiry();
        if (!this.joined) {
          this.joined = true;
          await this.transmit({ v: 1, kind: "join", nick: this.view.nick, ts: Date.now() }).catch(() => false);
        }
        return;
      }
      case "presence":
        return this.update({ n: e.n });
      case "msg":
        return this.receive(e.sealed);
      case "expired":
        return this.end(MELTED);
      case "error": {
        const fatal = FATAL[e.code];
        if (fatal) return this.end(fatal);
        if (e.code === "rate") return this.flash("slow down a little.");
        if (e.code === "too_big") return this.flash("too long. keep it under 4 KB.");
        return;
      }
      case "closed":
        return this.reconnectOrEnd();
    }
  }

  private async receive(sealed: { iv: string; ct: string }): Promise<void> {
    if (!this.keys) return;
    let m: Inner | null;
    try {
      m = decodeInner(await open(this.keys.key, this.keys.aad, sealed));
    } catch {
      return; // not for us, or tampered with: drop silently
    }
    if (!m || this.ended) return;
    switch (m.kind) {
      case "chat":
        return this.push({ kind: "chat", mine: false, nick: m.nick, text: m.text, ts: m.ts });
      case "join":
        return this.push({ kind: "system", mine: false, nick: m.nick, text: `${m.nick} joined`, ts: m.ts });
      case "leave":
        return this.push({ kind: "system", mine: false, nick: m.nick, text: `${m.nick} left`, ts: m.ts });
      case "nick":
        return this.push({ kind: "system", mine: false, nick: m.nick, text: `${m.prev} is now ${m.nick}`, ts: m.ts });
    }
  }

  private reconnectOrEnd(): void {
    const { expiresAt, offset } = this.view;
    const left = expiresAt === null ? 0 : expiresAt - (Date.now() + offset);
    if (left <= 0 || this.retries >= MAX_RETRIES) {
      this.end("lost the connection. the room key is gone from this tab.");
      return;
    }
    this.update({ status: "reconnecting" });
    const delay = 1000 * 2 ** this.retries++;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  /** if the relay's expiry message never arrives, melt locally anyway */
  private scheduleExpiry(): void {
    clearTimeout(this.expiryTimer);
    const { expiresAt, offset } = this.view;
    if (expiresAt === null) return;
    const ms = expiresAt - (Date.now() + offset) + 1500;
    // setTimeout can't take more than ~24.8 days, fine for a 24h max
    this.expiryTimer = setTimeout(() => this.end(MELTED), Math.max(0, ms));
  }

  private flash(hint: string): void {
    clearTimeout(this.hintTimer);
    this.update({ hint });
    this.hintTimer = setTimeout(() => this.update({ hint: null }), 3500);
  }

  private push(l: Omit<Line, "id">): void {
    const lines = [...this.view.lines, { ...l, id: this.nextId++ }].slice(-MAX_LINES);
    this.update({ lines });
  }

  private update(patch: Partial<View>): void {
    if (this.ended) return;
    this.view = { ...this.view, ...patch };
    emit();
  }
}

// ---- store ---------------------------------------------------------------

type Store = { session: Session | null; notice: string | null };
let store: Store = { session: null, notice: null };
let snapshot: { session: Session | null; view: View | null; notice: string | null } = {
  session: null,
  view: null,
  notice: null,
};
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = { session: store.session, view: store.session?.view ?? null, notice: store.notice };
  listeners.forEach((l) => l());
}

export function useStore() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

function replace(next: Session | null, notice: string | null = null): void {
  const prev = store.session;
  store = { session: next, notice };
  prev?.end(null);
  emit();
}

export async function createRoom(ttl: Ttl): Promise<void> {
  const secret = newSecret();
  const s = new Session(secret, await deriveRoom(secret), true);
  replace(s);
  navigate("/r");
  s.connect(ttl);
}

/** Read the secret from a `#fragment`. Returns false if it isn't a valid room link. */
export async function joinFromFragment(fragment: string): Promise<boolean> {
  let secret: Bytes;
  try {
    secret = fromB64url(fragment);
  } catch {
    return false;
  }
  if (secret.length !== SECRET_BYTES) return false;
  const s = new Session(secret, await deriveRoom(secret), false);
  replace(s);
  s.connect();
  return true;
}

export function setNotice(notice: string | null): void {
  store = { ...store, notice };
  emit();
}

/** tab closing or navigating away: say goodbye if we can, drop everything */
export function wipeNow(): void {
  void store.session?.leave(null);
}
