import type { ErrorCode, Ttl } from "@relay/protocol";
import { useSyncExternalStore } from "react";
import { open, seal } from "../crypto/aead";
import { deriveRoom, newSecret, type RoomKeys, SECRET_BYTES } from "../crypto/derive";
import {
  cleanNick,
  decodeInner,
  encodeInner,
  type Inner,
  newMsgId,
  type Reaction,
  TooLarge,
} from "../crypto/message";
import { type Bytes, fromB64url, toB64url } from "../lib/b64url";
import { randomNick } from "../lib/nick";
import { navigate } from "../lib/router";
import { RelayConnection, type RelayEvent } from "../net/relay";

export type Line = {
  id: number;
  kind: "chat" | "system";
  mine: boolean;
  nick: string;
  text: string;
  ts: number;
  /** chat only: the sender's message id, so reactions can find it */
  msgId?: string;
  /** burn-after-read: hidden until revealed, then gone after BURN_MS */
  burn?: boolean;
  revealed?: boolean;
  burnAt?: number;
  /** playing its drip-away animation, about to be removed */
  melting?: boolean;
  reactions?: Partial<Record<Reaction, string[]>>;
};
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
  /** nicknames currently typing */
  typing: string[];
  /** the creator has closed the door: nobody new can join */
  locked: boolean;
};

export const MELTED = "that room melted. everything's gone.";
export const MELTED_BY_CREATOR = "the creator melted the room. everything's gone.";
export const isMelted = (notice: string | null) => notice === MELTED || notice === MELTED_BY_CREATOR;

/** how long a burn-after-read message stays readable */
export const BURN_MS = 10_000;
const MELT_ANIM_MS = 900;
const TYPING_EVERY_MS = 3000;
const TYPING_SHOWN_MS = 4500;
const MAX_LINES = 500;
const MAX_RETRIES = 3;

const FATAL: Partial<Record<ErrorCode, string>> = {
  not_found: "that room doesn't exist, or it already melted.",
  gone: "that room already melted.",
  full: "that room is full. 8 people max.",
  limit: "too many new rooms from your network. try again in a while.",
  locked: "that room is locked. ask someone inside to unlock it.",
};

/** the creator's proof: a random secret kept in memory, and the hash the relay gets */
type Owner = { secret: Bytes; hash: string };

/**
 * Everything about the current room lives here, in memory only: the secret,
 * the derived key, the messages. `wipe()` drops all of it.
 */
class Session {
  view: View;
  private secret: Bytes | null;
  private keys: RoomKeys | null;
  private owner: Owner | null;
  private conn: RelayConnection | null = null;
  private joined = false;
  private ended = false;
  private retries = 0;
  private nextId = 1;
  private lastTyping = 0;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private burnTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(secret: Bytes, keys: RoomKeys, owner: Owner | null) {
    this.secret = secret;
    this.keys = keys;
    this.owner = owner;
    this.view = {
      status: "connecting",
      lines: [],
      n: 0,
      expiresAt: null,
      ttlMs: null,
      offset: 0,
      nick: randomNick(),
      isCreator: owner !== null,
      hint: null,
      typing: [],
      locked: false,
    };
  }

  connect(create?: Ttl): void {
    if (!this.keys) return;
    this.conn = new RelayConnection(this.keys.roomId, create, this.owner?.hash, (e) => void this.onEvent(e));
  }

  shareLink(): string | null {
    return this.secret ? `${location.origin}/r#${toB64url(this.secret)}` : null;
  }

  async send(raw: string, opts: { burn?: boolean } = {}): Promise<boolean> {
    const text = raw.trim();
    if (!text) return false;
    const m: Inner = {
      v: 1,
      kind: "chat",
      id: newMsgId(),
      nick: this.view.nick,
      text,
      ts: Date.now(),
      ...(opts.burn ? { burn: true as const } : {}),
    };
    try {
      if (!(await this.transmit(m))) {
        this.flash("not connected right now.");
        return false;
      }
    } catch (e) {
      if (e instanceof TooLarge) this.flash("too long. keep it under 4 KB.");
      return false;
    }
    this.lastTyping = 0;
    const line = this.push({
      kind: "chat",
      mine: true,
      nick: m.nick,
      text,
      ts: m.ts,
      msgId: m.id,
      burn: opts.burn,
      revealed: true,
      burnAt: opts.burn ? Date.now() + BURN_MS : undefined,
    });
    if (opts.burn) this.burnLater(line.id, BURN_MS);
    return true;
  }

  /** open a burn-after-read message: from now on it has BURN_MS to live */
  reveal(lineId: number): void {
    const line = this.view.lines.find((l) => l.id === lineId);
    if (!line?.burn || line.revealed) return;
    this.patchLine(lineId, { revealed: true, burnAt: Date.now() + BURN_MS });
    this.burnLater(lineId, BURN_MS);
  }

  /** call on every keystroke; sends an (encrypted) "typing" at most every few seconds */
  typing(): void {
    const now = Date.now();
    if (now - this.lastTyping < TYPING_EVERY_MS) return;
    this.lastTyping = now;
    void this.transmit({ v: 1, kind: "typing", nick: this.view.nick, ts: now }).catch(() => false);
  }

  async react(lineId: number, emoji: Reaction): Promise<void> {
    const line = this.view.lines.find((l) => l.id === lineId);
    if (!line?.msgId) return;
    const me = this.view.nick;
    const on = !(line.reactions?.[emoji] ?? []).includes(me);
    this.patchLine(lineId, { reactions: toggle(line.reactions, emoji, me, on) });
    await this.transmit({ v: 1, kind: "react", nick: me, target: line.msgId, emoji, on, ts: Date.now() }).catch(
      () => false,
    );
  }

  /** creator only: close or open the door for newcomers */
  lock(on: boolean): void {
    if (!this.owner || !this.conn?.control({ t: "lock", owner: toB64url(this.owner.secret), on })) {
      this.flash("not connected right now.");
    }
  }

  /** creator only: wipe the room for everyone, right now */
  meltNow(): void {
    if (!this.owner || !this.conn?.control({ t: "melt", owner: toB64url(this.owner.secret) })) {
      this.flash("not connected right now.");
    }
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
    this.owner?.secret.fill(0);
    this.owner = null;
    this.keys = null;
    this.conn?.close();
    this.conn = null;
    clearTimeout(this.expiryTimer);
    clearTimeout(this.hintTimer);
    clearTimeout(this.retryTimer);
    this.typingTimers.forEach(clearTimeout);
    this.typingTimers.clear();
    this.burnTimers.forEach(clearTimeout);
    this.burnTimers.clear();
    this.view = { ...this.view, lines: [], nick: "", hint: null, typing: [] };
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
          locked: e.locked,
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
      case "locked":
        if (e.on === this.view.locked) return;
        this.update({ locked: e.on });
        this.push({
          kind: "system",
          mine: false,
          nick: "",
          text: e.on ? "the room is locked. nobody new can join." : "the room is open again.",
          ts: Date.now(),
        });
        return;
      case "msg":
        return this.receive(e.sealed);
      case "expired":
        return this.end(MELTED);
      case "melted":
        return this.end(this.owner ? MELTED : MELTED_BY_CREATOR);
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
        this.stopTyping(m.nick);
        this.push({
          kind: "chat",
          mine: false,
          nick: m.nick,
          text: m.text,
          ts: m.ts,
          msgId: m.id,
          burn: m.burn,
          revealed: !m.burn,
        });
        return;
      case "typing":
        return this.startTyping(m.nick);
      case "react": {
        const line = this.view.lines.find((l) => l.msgId === m.target);
        if (line) this.patchLine(line.id, { reactions: toggle(line.reactions, m.emoji, m.nick, m.on) });
        return;
      }
      case "join":
        this.push({ kind: "system", mine: false, nick: m.nick, text: `${m.nick} joined`, ts: m.ts });
        return;
      case "leave":
        this.stopTyping(m.nick);
        this.push({ kind: "system", mine: false, nick: m.nick, text: `${m.nick} left`, ts: m.ts });
        return;
      case "nick":
        this.stopTyping(m.prev);
        this.push({ kind: "system", mine: false, nick: m.nick, text: `${m.prev} is now ${m.nick}`, ts: m.ts });
        return;
    }
  }

  private startTyping(nick: string): void {
    clearTimeout(this.typingTimers.get(nick));
    this.typingTimers.set(
      nick,
      setTimeout(() => this.stopTyping(nick), TYPING_SHOWN_MS),
    );
    if (!this.view.typing.includes(nick)) this.update({ typing: [...this.view.typing, nick] });
  }

  private stopTyping(nick: string): void {
    clearTimeout(this.typingTimers.get(nick));
    this.typingTimers.delete(nick);
    if (this.view.typing.includes(nick)) this.update({ typing: this.view.typing.filter((n) => n !== nick) });
  }

  /** let a burn-after-read line drip away, then drop it */
  private burnLater(lineId: number, ms: number): void {
    const t = setTimeout(() => {
      this.burnTimers.delete(t);
      this.patchLine(lineId, { melting: true });
      const gone = setTimeout(() => {
        this.burnTimers.delete(gone);
        this.update({ lines: this.view.lines.filter((l) => l.id !== lineId) });
      }, MELT_ANIM_MS);
      this.burnTimers.add(gone);
    }, ms);
    this.burnTimers.add(t);
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

  private push(l: Omit<Line, "id">): Line {
    const line = { ...l, id: this.nextId++ };
    this.update({ lines: [...this.view.lines, line].slice(-MAX_LINES) });
    return line;
  }

  private patchLine(lineId: number, patch: Partial<Line>): void {
    this.update({ lines: this.view.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) });
  }

  private update(patch: Partial<View>): void {
    if (this.ended) return;
    this.view = { ...this.view, ...patch };
    emit();
  }
}

function toggle(
  reactions: Line["reactions"],
  emoji: Reaction,
  nick: string,
  on: boolean,
): NonNullable<Line["reactions"]> {
  const who = (reactions?.[emoji] ?? []).filter((n) => n !== nick);
  return { ...reactions, [emoji]: on ? [...who, nick] : who };
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
  const ownerSecret = crypto.getRandomValues(new Uint8Array(32));
  const hash = toB64url(new Uint8Array(await crypto.subtle.digest("SHA-256", ownerSecret)));
  const s = new Session(secret, await deriveRoom(secret), { secret: ownerSecret, hash });
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
  const s = new Session(secret, await deriveRoom(secret), null);
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
