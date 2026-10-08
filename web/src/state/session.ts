import { type ClientFrame, type ErrorCode, RATE_BURST, RATE_PER_SEC, type Ttl } from "@relay/protocol";
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
import { anchorClock, nextRetry, type ServerClock, serverTime } from "./resilience";

export type Line = {
  /** the relay refused to forward it (rate limit): the others probably never saw it */
  undelivered?: boolean;
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
  /**
   * serverNow - Date.now(). Derived from a monotonic clock (see `serverNow()`), and
   * refreshed when the device clock jumps, so `Date.now() + offset` stays right.
   */
  offset: number;
  nick: string;
  isCreator: boolean;
  hint: string | null;
  /** nicknames currently typing */
  typing: string[];
  /** the creator has closed the door: nobody new can join */
  locked: boolean;
};

/**
 * Why a room ended (or can't start), for the dedicated error screen.
 * `unreachable` is the one case where the key is still in memory: the relay
 * never answered, and "try again" reuses it.
 */
export type RoomErrorKind =
  | "not_found"
  | "expired"
  | "melted"
  | "full"
  | "locked"
  | "limit"
  | "slow"
  | "unreachable"
  | "lost";

export const MELTED = "that room melted. everything's gone.";
export const MELTED_BY_CREATOR = "the creator melted the room.";
export const isMelted = (notice: string | null) => notice === MELTED || notice === MELTED_BY_CREATOR;

/** what the error screen leads with; the screen adds the rest */
export const NOTICES = {
  not_found: "that room doesn't exist, or it already melted.",
  gone: "that room already melted.",
  goneWhileAway: "the room melted while you were away.",
  timerRanOut: "the timer ran out.",
  full: "that room is full. 8 people max.",
  locked: "that room is locked. ask someone inside to unlock it.",
  limit: "too many new rooms from your network. try again in a while.",
  slow: "too many connection attempts from your network.",
  lost: "the connection was gone for too long, so this tab let the room go.",
} as const;

/** burn-after-read: how long a message stays readable */
export const BURN_MS = 10_000;
const MELT_ANIM_MS = 900;
const TYPING_EVERY_MS = 3000;
const TYPING_SHOWN_MS = 4500;
const MAX_LINES = 500;
/** how often the session checks its clock and refreshes the pre-sealed goodbye */
const TICK_MS = 5000;
/** the pre-sealed "leave" frame is re-sealed (fresh ts) at most this often */
const RESEAL_MS = 60_000;
/** after "slow" from the relay, reconnect at the slowest pace */
const SLOW_ATTEMPT = 8;

/** the creator's proof: a random secret kept in memory, and the hash the relay gets */
type Owner = { secret: Bytes; hash: string };

/**
 * Everything about the current room lives here, in memory only: the secret,
 * the derived key, the messages. `wipe()` drops all of it, synchronously.
 */
export class Session {
  view: View;
  private secret: Bytes | null;
  private keys: RoomKeys | null;
  private owner: Owner | null;
  private conn: RelayConnection | null = null;
  /** bumped per connection, so a stale socket's events are ignored */
  private connSeq = 0;
  /** the ttl to create the room with, until the relay has said hello once */
  private createTtl: Ttl | undefined;
  private everLive = false;
  /** relay never answered before the first hello: waiting for "try again", key still here */
  private paused = false;
  private attempt = 0;
  /** performance.now() when the connection was lost, for the offline cap */
  private lostAt: number | null = null;
  private clock: ServerClock | null = null;
  private joined = false;
  /** the nick the others last heard from us */
  private announcedNick: string | null = null;
  private ended = false;
  /** a ready-to-send, already-encrypted "leave" frame, so leaving never has to await */
  private leaveFrame: string | null = null;
  private leaveSeq = 0;
  private leaveSealedAt = -Infinity;
  private nextId = 1;
  private lastTyping = 0;
  /**
   * The relay allows RATE_BURST frames, refilled at RATE_PER_SEC, per connection, and silently
   * drops the rest. Mirror that here (a little more strictly), so a message is refused up front,
   * draft kept, instead of looking sent while nobody received it.
   */
  private tokens = RATE_BURST;
  private tokensAt = 0;
  /** why the last transmit() returned false */
  private refusal: "offline" | "rate" | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private tickTimer: ReturnType<typeof setInterval> | undefined;
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private burnTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(secret: Bytes, keys: RoomKeys, owner: Owner | null, create?: Ttl) {
    this.secret = secret;
    this.keys = keys;
    this.owner = owner;
    this.createTtl = create;
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

  connect(): void {
    if (!this.keys || this.ended || this.paused) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.conn?.close();
    this.conn = null;
    const seq = ++this.connSeq;
    const conn = new RelayConnection(this.keys.roomId, this.everLive ? undefined : this.createTtl, this.owner?.hash, (e) => {
      if (seq !== this.connSeq) return;
      // lifecycle events can come from inside the constructor (a socket that can't even be built)
      if (e.type === "closed" || e.type === "unreachable") queueMicrotask(() => seq === this.connSeq && this.onLost());
      else void this.onEvent(e);
    });
    if (seq === this.connSeq) this.conn = conn;
  }

  /** server time from the monotonic clock anchored at the last hello */
  serverNow(): number {
    return this.clock ? serverTime(this.clock, performance.now()) : Date.now() + this.view.offset;
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
        this.flash(this.refusal === "rate" ? "slow down a little. your message is still in the box." : "not connected right now.");
        return false;
      }
    } catch (e) {
      if (e instanceof TooLarge) this.flash("too long. keep it under 4 KB.");
      return false;
    }
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
    // typing notices are a nicety: never spend the last tokens a real message would need
    if (!this.conn?.open || !this.hasTokens(3)) return;
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
    void this.resealLeave();
    // offline? then the others hear about it after the reconnect (see hello)
    if (this.joined && (await this.transmit({ v: 1, kind: "nick", nick, prev, ts: Date.now() }).catch(() => false))) {
      this.announcedNick = nick;
    }
    this.push({ kind: "system", mine: true, nick, text: `you're ${nick} now`, ts: Date.now() });
  }

  /**
   * Say goodbye with the pre-sealed frame (if the socket is open), then wipe.
   * Fully synchronous: nothing here awaits, so a page frozen right after this
   * call (back/forward cache) holds no keys.
   */
  leave(notice: string | null): void {
    if (this.ended) return;
    if (this.leaveFrame && this.conn?.open) this.conn.sendRaw(this.leaveFrame);
    this.end(notice);
  }

  end(notice: string | null, error: RoomErrorKind | null = null): void {
    if (this.ended) return;
    this.ended = true;
    this.wipe();
    if (store.session === this) {
      store = { session: null, notice, error };
      emit();
      if (typeof location !== "undefined" && location.pathname === "/r") navigate("/", { replace: true });
    }
  }

  /** the relay never answered: "try again" with the key that is still in memory */
  retry(): void {
    if (this.ended || !this.paused) return;
    this.paused = false;
    this.attempt = 0;
    this.lostAt = null;
    if (store.session === this) store = { ...store, error: null, notice: null };
    this.update({ status: this.everLive ? "reconnecting" : "connecting" });
    this.connect();
  }

  /** the network came back, or the tab became visible: don't wait out the backoff */
  wake(reason: "online" | "visible"): void {
    if (this.ended) return;
    if (this.isExpired()) return this.end(NOTICES.timerRanOut, "expired");
    this.tick();
    if (this.paused) {
      if (reason === "online") this.retry();
      return;
    }
    if (this.retryTimer !== undefined) {
      // a fresh network deserves a fresh backoff; before the first hello keep counting tries
      if (reason === "online" && this.everLive) this.attempt = 0;
      this.connect();
    }
  }

  /** the browser says it's offline: the socket is dead, start reconnecting */
  networkDown(): void {
    if (this.ended || this.paused || !this.conn) return;
    this.onLost();
  }

  private wipe(): void {
    this.secret?.fill(0);
    this.secret = null;
    this.owner?.secret.fill(0);
    this.owner = null;
    this.keys = null;
    this.leaveFrame = null;
    this.leaveSeq++;
    this.clock = null;
    this.connSeq++;
    this.conn?.close();
    this.conn = null;
    clearTimeout(this.expiryTimer);
    clearTimeout(this.hintTimer);
    clearTimeout(this.retryTimer);
    clearInterval(this.tickTimer);
    this.retryTimer = undefined;
    this.tickTimer = undefined;
    this.typingTimers.forEach(clearTimeout);
    this.typingTimers.clear();
    this.burnTimers.forEach(clearTimeout);
    this.burnTimers.clear();
    this.view = { ...this.view, lines: [], nick: "", hint: null, typing: [] };
  }

  private hasTokens(n: number): boolean {
    const now = performance.now();
    // refill a bit slower than the relay does, to stay clear of jitter
    this.tokens = Math.min(RATE_BURST, this.tokens + ((now - this.tokensAt) / 1000) * RATE_PER_SEC * 0.85);
    this.tokensAt = now;
    return this.tokens >= n;
  }

  private async transmit(m: Inner): Promise<boolean> {
    this.refusal = null;
    if (!this.keys || !this.conn?.open) {
      this.refusal = "offline";
      return false;
    }
    if (!this.hasTokens(1)) {
      this.refusal = "rate";
      return false;
    }
    this.tokens -= 1;
    const sealed = await seal(this.keys.key, this.keys.aad, encodeInner(m));
    return this.conn?.send(sealed) ?? false;
  }

  /** keep one encrypted goodbye ready, so leaving (and pagehide) can send it without awaiting */
  private async resealLeave(): Promise<void> {
    const keys = this.keys;
    if (!keys || this.ended) return;
    const seq = ++this.leaveSeq;
    this.leaveSealedAt = performance.now();
    try {
      const sealed = await seal(keys.key, keys.aad, encodeInner({ v: 1, kind: "leave", nick: this.view.nick, ts: Date.now() }));
      if (seq !== this.leaveSeq || this.ended) return;
      const frame: ClientFrame = { t: "msg", iv: sealed.iv, ct: sealed.ct };
      this.leaveFrame = JSON.stringify(frame);
    } catch {
      // keep the previous one
    }
  }

  private async onEvent(e: Exclude<RelayEvent, { type: "closed" } | { type: "unreachable" }>): Promise<void> {
    if (this.ended) return;
    switch (e.type) {
      case "hello": {
        this.clock = anchorClock(e.now, performance.now());
        this.everLive = true;
        this.createTtl = undefined;
        this.attempt = 0;
        this.lostAt = null;
        this.update({
          status: "live",
          n: e.n,
          expiresAt: e.expiresAt,
          ttlMs: e.ttl * 1000,
          offset: Math.round(e.now - Date.now()),
          locked: e.locked,
        });
        this.scheduleExpiry();
        this.startTick();
        void this.resealLeave();
        if (!this.joined) {
          // only once per room: a reconnect never repeats the join notice
          const nick = this.view.nick;
          this.joined = await this.transmit({ v: 1, kind: "join", nick, ts: Date.now() }).catch(() => false);
          if (this.joined) this.announcedNick = nick;
        } else if (this.announcedNick !== null && this.announcedNick !== this.view.nick) {
          // renamed while offline: the others never heard it
          const nick = this.view.nick;
          const sent = await this.transmit({ v: 1, kind: "nick", nick, prev: this.announcedNick, ts: Date.now() }).catch(
            () => false,
          );
          if (sent) this.announcedNick = nick;
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
        return this.end(NOTICES.timerRanOut, "expired");
      case "melted":
        // the creator did it themselves: back to the start with the melt curtain, no error
        return this.owner ? this.end(MELTED) : this.end(MELTED_BY_CREATOR, "melted");
      case "error":
        return this.onError(e.code);
    }
  }

  private onError(code: ErrorCode): void {
    switch (code) {
      case "not_found":
        return this.end(NOTICES.not_found, "not_found");
      case "gone":
        return this.end(this.everLive ? NOTICES.goneWhileAway : NOTICES.gone, "expired");
      case "full":
        return this.end(NOTICES.full, "full");
      case "locked":
        return this.end(NOTICES.locked, "locked");
      case "limit":
        return this.end(NOTICES.limit, "limit");
      case "slow":
        // mid-room: back off to the slowest pace, the close that follows retries
        if (this.everLive) {
          this.attempt = Math.max(this.attempt, SLOW_ATTEMPT);
          return;
        }
        return this.end(NOTICES.slow, "slow");
      case "rate": {
        // the room-wide budget can still refuse a frame we thought we could send: say so on the bubble
        const cutoff = Date.now() - 3000;
        const last = [...this.view.lines].reverse().find((l) => l.mine && l.kind === "chat" && l.ts >= cutoff);
        if (last && !last.undelivered) this.patchLine(last.id, { undelivered: true });
        return this.flash("slow down a little. your last message may not have arrived.");
      }
      case "too_big":
        return this.flash("too long. keep it under 4 KB.");
      default:
        return;
    }
  }

  /**
   * The socket closed or never opened. Before the first hello: a few quick tries,
   * then the "unreachable" screen (key kept for "try again"). After it: keep trying
   * with capped backoff until the room expires or the offline cap is hit.
   */
  private onLost(): void {
    if (this.ended || this.paused) return;
    this.connSeq++;
    this.conn?.close();
    this.conn = null;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    const now = performance.now();
    this.lostAt ??= now;
    const d = nextRetry({
      attempt: this.attempt,
      everLive: this.everLive,
      expiresAt: this.view.expiresAt,
      serverNow: this.clock ? this.serverNow() : null,
      downForMs: now - this.lostAt,
    });
    if (d.kind === "stop") {
      if (d.reason === "expired") return this.end(NOTICES.timerRanOut, "expired");
      if (d.reason === "lost") return this.end(NOTICES.lost, "lost");
      return this.pause();
    }
    this.attempt++;
    if (this.everLive && this.view.status !== "reconnecting") this.update({ status: "reconnecting" });
    this.retryTimer = setTimeout(() => this.connect(), d.delayMs);
  }

  private pause(): void {
    this.paused = true;
    if (store.session === this) {
      store = { ...store, notice: null, error: "unreachable" };
      emit();
    }
  }

  private isExpired(): boolean {
    return this.clock !== null && this.view.expiresAt !== null && this.serverNow() >= this.view.expiresAt;
  }

  private startTick(): void {
    if (this.tickTimer !== undefined) return;
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  /** keep `view.offset` honest if the device clock jumped, and the goodbye fresh */
  private tick(): void {
    if (this.ended || !this.clock) return;
    const offset = Math.round(this.serverNow() - Date.now());
    if (Math.abs(offset - this.view.offset) > 1000) this.update({ offset });
    if (this.view.status === "live" && performance.now() - this.leaveSealedAt >= RESEAL_MS) void this.resealLeave();
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

  /** if the relay's expiry message never arrives, melt locally anyway (by server time) */
  private scheduleExpiry(): void {
    clearTimeout(this.expiryTimer);
    const { expiresAt } = this.view;
    if (expiresAt === null) return;
    const ms = expiresAt - this.serverNow() + 1500;
    // setTimeout can't take more than ~24.8 days, fine for a 24h max
    this.expiryTimer = setTimeout(() => this.end(NOTICES.timerRanOut, "expired"), Math.max(0, ms));
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

type Store = { session: Session | null; notice: string | null; error: RoomErrorKind | null };
type Snapshot = Store & { view: View | null };
let store: Store = { session: null, notice: null, error: null };
let snapshot: Snapshot = { session: null, view: null, notice: null, error: null };
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = { session: store.session, view: store.session?.view ?? null, notice: store.notice, error: store.error };
  listeners.forEach((l) => l());
}

export function useStore(): Snapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

/** the current snapshot, outside React (tests, event handlers) */
export function getStore(): Snapshot {
  return snapshot;
}

/** server time for the open room (monotonic, see resilience.ts), or local time without one */
export function serverNow(): number {
  return store.session?.serverNow() ?? Date.now();
}

function replace(next: Session | null, notice: string | null = null): void {
  const prev = store.session;
  store = { session: next, notice, error: null };
  prev?.end(null);
  emit();
}

export async function createRoom(ttl: Ttl): Promise<void> {
  const secret = newSecret();
  const ownerSecret = crypto.getRandomValues(new Uint8Array(32));
  const hash = toB64url(new Uint8Array(await crypto.subtle.digest("SHA-256", ownerSecret)));
  const s = new Session(secret, await deriveRoom(secret), { secret: ownerSecret, hash }, ttl);
  replace(s);
  navigate("/r");
  s.connect();
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

/**
 * Tab closing, navigating away, or going into the back/forward cache. Sends the
 * pre-sealed goodbye if the socket is open, then wipes: secret and owner secret
 * zeroed, keys dropped, lines and timers cleared, socket closed, store emptied.
 * Synchronous on purpose; there is no await anywhere on this path.
 */
export function wipeNow(): void {
  store.session?.leave(null);
  store = { session: null, notice: null, error: null };
  emit();
}

/** back to a clean start screen: no session, no notice, no error (bfcache restore, "open a new room") */
export function resetToStart(): void {
  wipeNow();
}

/** "try again" on the unreachable screen */
export function retryRoom(): void {
  store.session?.retry();
}

/** `online` / tab visible again */
export function wake(reason: "online" | "visible"): void {
  store.session?.wake(reason);
}

/** `offline` */
export function networkDown(): void {
  store.session?.networkDown();
}
