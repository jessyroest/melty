import { type ClientFrame, type ErrorCode, MAX_LOBBY, RATE_BURST, RATE_PER_SEC, type Ttl } from "@relay/protocol";
import { useSyncExternalStore } from "react";
import type { Sealed } from "../crypto/aead";
import { deriveLink, importRoomKey, type LinkKeys, newSecret, ROOM_KEY_BYTES, type RoomKeys, SECRET_BYTES } from "../crypto/derive";
import { LEAVE_COUNTER, newSenderId, openMsg, ReplayGuard, sealMsg } from "../crypto/frame";
import type { HostKeys, KxMode, KxMsg, KxResult } from "../crypto/kx";
import * as kx from "../crypto/kx";
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
import { codeToWire, codeWords, type DoorCode, newDoorCode } from "../crypto/words";
import { RelayConnection, type RelayEvent, type Target } from "../net/relay";
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
/**
 * `waiting`: in the room (came with the link), waiting for someone inside to hand over the key.
 * `knocking`: at the door with the 4 words, waiting for someone inside to let you in.
 */
export type Status = "connecting" | "live" | "reconnecting" | "waiting" | "knocking";

/** how this tab got into the room */
export type Entry = "create" | "link" | "code";

/** someone at the door with the 4 words, waiting for a person inside to answer */
export type Knock = { hs: string; at: number };

/**
 * A safety code to compare outside the app: 6 words from the key exchange's transcript.
 * If someone sat in the middle of the exchange, the two sides see different words.
 */
export type SafetyCheck = {
  hs: string;
  /** "joiner": you were let in by `peer`. "host": you let `peer` in. */
  role: "joiner" | "host";
  /** their nickname, as they call themselves (unverified, like every nick) */
  peer: string | null;
  words: string[];
  state: "open" | "match" | "mismatch";
};

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
  /** screenshot deterrents (the creator's choice, for everyone): blur until touched, blur when away, watermark */
  deter: boolean;
  entry: Entry;
  /** the room's 4 words, once this tab knows them */
  words: string[] | null;
  /** people knocking with the 4 words; anyone inside can let them in */
  knocks: Knock[];
  /** safety codes from the key exchanges this tab took part in with the 4 words */
  checks: SafetyCheck[];
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
  | "lost"
  /** nobody inside handed over the key (or let you in); the link or words are kept for "try again" */
  | "nobody"
  /** someone inside turned the knock down */
  | "turned_away"
  /** you said the safety code didn't match */
  | "mismatch";

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
  noWords: "no room answers to those words. check them, or the room may have melted.",
  lobbyFull: "a few people are already knocking. try again in a minute.",
  nobodyLink: "nobody inside handed over the key. someone has to be in the room to let you in.",
  nobodyWords: "nobody let you in. someone inside has to say yes.",
  turnedAway: "someone inside said no.",
  mismatch: "you said the safety words didn't match, so this tab left. someone may have been in the middle.",
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
/** link join: ask for the key again if nobody answered within this, a few times */
const LINK_WAIT_MS = 8000;
const LINK_TRIES = 3;
/** knock: give up waiting to be let in after this (the relay closes the lobby socket at 3 min) */
export const KNOCK_WAIT_MS = 150_000;
/** host: a handshake that doesn't finish in this time is dropped */
const HOST_WAIT_MS = 60_000;
/** link joins are answered automatically: the creator at once, others a moment later unless someone did */
const ANSWER_DELAY_MS = [1200, 2500] as const;
/** messages that arrive before this tab has the key: kept encrypted until it does */
const MAX_PENDING = 64;
/** a create whose words are taken tries fresh words this many times */
const WORD_TRIES = 3;

/** the creator's proof: a random secret kept in memory, and the hash the relay gets */
type Owner = { secret: Bytes; hash: string };

/** a handshake this tab is hosting (handing the room key to someone) */
type Hosting = { tag: string; hs: Bytes; mode: KxMode; keys: HostKeys; timer: ReturnType<typeof setTimeout> };
/** the handshake this tab is joining through */
type Joining = { hs: Bytes; mode: KxMode; result: KxResult | null; host: string | null };

/** what a tab starts with: the creator has everything; a link joiner the link; a knocker only the words */
type Init =
  | { entry: "create"; link: Bytes; roomKey: Bytes; link_: LinkKeys; key: CryptoKey; code: DoorCode; owner: Owner; ttl: Ttl }
  | { entry: "link"; link: Bytes; link_: LinkKeys }
  | { entry: "code"; code: DoorCode };

/**
 * Everything about the current room lives here, in memory only: the secret,
 * the derived key, the messages. `wipe()` drops all of it, synchronously.
 */
export class Session {
  view: View;
  /** the link secret: the room id and the link's psk come from it */
  private link: Bytes | null;
  private linkKeys: LinkKeys | null;
  /** raw room key, kept only to hand to newcomers through the key exchange */
  private roomKey: Bytes | null;
  private keys: RoomKeys | null;
  private code: DoorCode | null;
  private owner: Owner | null;
  private conn: RelayConnection | null = null;
  /** bumped per connection, so a stale socket's events are ignored */
  private connSeq = 0;
  /** this socket's tag at the relay, for key-exchange frames */
  private tag: string | null = null;
  /** the ttl to create the room with, until the relay has said hello once */
  private createTtl: Ttl | undefined;
  private wordTries = 0;
  private everLive = false;
  /** waiting for "try again" (relay unreachable, or nobody let us in); what we came with is still here */
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
  /** replay protection: our sender id and counter, and what we've seen from the others */
  private sender = newSenderId();
  private counter = 0;
  private guard = new ReplayGuard();
  /** room messages that came in before we had the key, still encrypted */
  private pending: Sealed[] = [];
  /** key exchange */
  private joining: Joining | null = null;
  private joinTries = 0;
  /** the handshake that let us in, mentioned in our join notice */
  private joinedVia: string | null = null;
  private hosting = new Map<string, Hosting>();
  /** link joins we'll answer in a moment, unless someone else does first */
  private answerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** knocks waiting for a yes or no: hs → the knocker's tag */
  private knockers = new Map<string, { tag: string; hs: Bytes; timer: ReturnType<typeof setTimeout> }>();
  /** handshakes someone else inside is already handling */
  private handled = new Set<string>();
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
  private kxTimer: ReturnType<typeof setTimeout> | undefined;
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private burnTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(init: Init) {
    this.link = init.entry === "code" ? null : init.link;
    this.linkKeys = init.entry === "code" ? null : init.link_;
    this.roomKey = init.entry === "create" ? init.roomKey : null;
    this.keys = init.entry === "create" ? { ...init.link_, key: init.key } : null;
    this.code = init.entry === "link" ? null : init.code;
    this.owner = init.entry === "create" ? init.owner : null;
    this.createTtl = init.entry === "create" ? init.ttl : undefined;
    this.view = {
      status: "connecting",
      lines: [],
      n: 0,
      expiresAt: null,
      ttlMs: null,
      offset: 0,
      nick: randomNick(),
      isCreator: init.entry === "create",
      hint: null,
      typing: [],
      locked: false,
      deter: false,
      entry: init.entry,
      words: this.code ? codeWords(this.code) : null,
      knocks: [],
      checks: [],
    };
  }

  connect(): void {
    if (this.ended || this.paused) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.conn?.close();
    this.conn = null;
    this.tag = null;
    let target: Target;
    if (this.linkKeys) {
      const create = this.everLive ? undefined : this.createTtl;
      target = {
        roomId: this.linkKeys.roomId,
        create,
        owner: this.owner?.hash,
        words: create && this.code ? codeToWire(this.code) : undefined,
      };
    } else if (this.code) {
      target = { knock: codeToWire(this.code) };
    } else return;
    const seq = ++this.connSeq;
    const conn = new RelayConnection(target, (e) => {
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

  /** the link to share; only once this tab is a member (a knocker doesn't have it yet) */
  shareLink(): string | null {
    return this.link && this.keys ? `${location.origin}/r#${toB64url(this.link)}` : null;
  }

  /** a person inside said yes to a knock: run the key exchange with them */
  letIn(hs: string): void {
    const k = this.knockers.get(hs);
    this.dropKnock(hs);
    if (!k || this.handled.has(hs) || !this.canHost()) return;
    this.host(k.tag, k.hs, "code");
  }

  /** a person inside said no */
  turnAway(hs: string): void {
    const k = this.knockers.get(hs);
    this.dropKnock(hs);
    if (!k || !this.conn) return;
    this.sendKx(k.tag, { k: "no", hs: k.hs });
    void this.transmit({ v: 1, kind: "door", nick: this.view.nick, hs, act: "no", ts: Date.now() }).catch(() => false);
  }

  /** the two sides compared the safety words */
  confirmCheck(hs: string, match: boolean): void {
    const c = this.view.checks.find((x) => x.hs === hs);
    if (!c || c.state !== "open") return;
    this.update({ checks: this.view.checks.map((x) => (x.hs === hs ? { ...x, state: match ? "match" : "mismatch" } : x)) });
    if (match) return;
    if (c.role === "joiner") return this.end(NOTICES.mismatch, "mismatch");
    this.push({
      kind: "system",
      mine: true,
      nick: "",
      text: this.owner
        ? "the safety words didn't match. someone may be in the middle. melt the room and start over."
        : "the safety words didn't match. someone may be in the middle. leave, and tell the others.",
      ts: Date.now(),
    });
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
  /** creator only: screenshot deterrents for everyone in the room (a deterrent, not a guarantee) */
  deter(on: boolean): void {
    if (!this.owner || !this.conn?.control({ t: "deter", owner: toB64url(this.owner.secret), on })) {
      this.flash("not connected right now.");
    }
  }

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

  /** "try again": the relay never answered, or nobody let us in. What we came with is still in memory. */
  retry(): void {
    if (this.ended || !this.paused) return;
    this.paused = false;
    this.attempt = 0;
    this.joinTries = 0;
    this.lostAt = null;
    if (store.session === this) store = { ...store, error: null, notice: null };
    this.update({ status: this.everLive && this.keys ? "reconnecting" : "connecting" });
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
    this.link?.fill(0);
    this.link = null;
    this.roomKey?.fill(0);
    this.roomKey = null;
    this.linkKeys?.psk.fill(0);
    this.linkKeys = null;
    this.owner?.secret.fill(0);
    this.owner = null;
    this.keys = null;
    this.code = null;
    this.joining?.result?.bundleKey.fill(0);
    this.joining = null;
    for (const h of this.hosting.values()) {
      kx.wipeHost(h.keys);
      clearTimeout(h.timer);
    }
    this.hosting.clear();
    this.answerTimers.forEach(clearTimeout);
    this.answerTimers.clear();
    for (const k of this.knockers.values()) clearTimeout(k.timer);
    this.knockers.clear();
    this.handled.clear();
    this.pending = [];
    this.guard.clear();
    clearTimeout(this.kxTimer);
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
    this.view = { ...this.view, lines: [], nick: "", hint: null, typing: [], words: null, knocks: [], checks: [] };
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
    // the counter is taken before the await, so two sends in flight never share one
    const sealed = await sealMsg(this.keys.key, this.keys.aad, this.sender, this.counter++, encodeInner(m));
    return this.conn?.send(sealed) ?? false;
  }

  /** key-exchange frames count against the relay's rate limit too */
  private sendKx(to: string | undefined, m: KxMsg): boolean {
    this.hasTokens(0);
    this.tokens = Math.max(0, this.tokens - 1);
    return this.conn?.sendKx(to, kx.encodeKx(m)) ?? false;
  }

  /** keep one encrypted goodbye ready, so leaving (and pagehide) can send it without awaiting */
  private async resealLeave(): Promise<void> {
    const keys = this.keys;
    if (!keys || this.ended) return;
    const seq = ++this.leaveSeq;
    this.leaveSealedAt = performance.now();
    try {
      const inner = encodeInner({ v: 1, kind: "leave", nick: this.view.nick, ts: Date.now() });
      // always the last thing we send, so it takes the highest counter there is
      const sealed = await sealMsg(keys.key, keys.aad, this.sender, LEAVE_COUNTER, inner);
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
        this.tag = e.tag;
        this.everLive = true;
        this.createTtl = undefined;
        this.attempt = 0;
        this.lostAt = null;
        this.update({
          n: e.n,
          expiresAt: e.expiresAt,
          ttlMs: e.ttl * 1000,
          offset: Math.round(e.now - Date.now()),
          locked: e.locked,
          deter: e.deter,
        });
        this.scheduleExpiry();
        this.startTick();
        if (e.lobby) {
          this.update({ status: "knocking" });
          return this.startJoin("code");
        }
        if (!this.keys) {
          this.update({ status: "waiting" });
          // just us in here: nobody can hand over the key
          if (e.n <= 1) return this.pause("nobody", NOTICES.nobodyLink);
          return this.startJoin("link");
        }
        return this.goLive();
      }
      case "kx":
        return this.onKx(e.from, e.d);
      case "presence":
        return this.update({ n: e.n });
      case "deter":
        if (e.on === this.view.deter) return;
        this.update({ deter: e.on });
        this.push({
          kind: "system",
          mine: false,
          nick: "",
          text: e.on
            ? "screenshot deterrents on: messages blur until you touch them."
            : "screenshot deterrents off.",
          ts: Date.now(),
        });
        return;
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

  /** connected and holding the key: announce ourselves, catch up on what arrived before the key */
  private async goLive(): Promise<void> {
    this.update({ status: "live" });
    void this.resealLeave();
    const early = this.pending;
    this.pending = [];
    for (const s of early) await this.receive(s);
    if (this.ended) return;
    if (!this.joined) {
      // only once per room: a reconnect never repeats the join notice
      const nick = this.view.nick;
      const m: Inner = { v: 1, kind: "join", nick, ts: Date.now(), ...(this.joinedVia ? { hs: this.joinedVia } : {}) };
      this.joined = await this.transmit(m).catch(() => false);
      if (this.joined) this.announcedNick = nick;
    } else if (this.announcedNick !== null && this.announcedNick !== this.view.nick) {
      // renamed while offline: the others never heard it
      const nick = this.view.nick;
      const sent = await this.transmit({ v: 1, kind: "nick", nick, prev: this.announcedNick, ts: Date.now() }).catch(
        () => false,
      );
      if (sent) this.announcedNick = nick;
    }
  }

  // ---- key exchange: joining ------------------------------------------------

  /** ask the people inside for the key (link) or to be let in (words) */
  private startJoin(mode: KxMode): void {
    clearTimeout(this.kxTimer);
    this.joining?.result?.bundleKey.fill(0);
    const hs = kx.newHandshakeId();
    this.joining = { hs, mode, result: null, host: null };
    this.sendKx(undefined, { k: "req", hs, mode });
    this.kxTimer = setTimeout(() => this.joinTimedOut(), mode === "link" ? LINK_WAIT_MS : KNOCK_WAIT_MS);
  }

  private joinTimedOut(): void {
    if (this.ended || this.keys || !this.joining) return;
    if (this.joining.mode === "link" && ++this.joinTries < LINK_TRIES) return this.startJoin("link");
    this.pause("nobody", this.joining.mode === "link" ? NOTICES.nobodyLink : NOTICES.nobodyWords);
  }

  private onKx(from: string, d: string): void {
    const m = kx.decodeKx(d);
    if (!m || this.ended) return;
    switch (m.k) {
      case "req":
        return this.onRequest(from, m);
      case "offer":
        return this.onOffer(from, m);
      case "ans":
        return void this.onAnswer(from, m);
      case "key":
        return void this.onKey(from, m);
      case "no":
        if (this.joining?.mode === "code" && sameId(this.joining.hs, m.hs) && !this.keys) {
          return this.end(NOTICES.turnedAway, "turned_away");
        }
        return;
    }
  }

  private onOffer(from: string, m: Extract<KxMsg, { k: "offer" }>): void {
    const j = this.joining;
    // the first offer wins; the rest are ignored
    if (!j || j.result || !sameId(j.hs, m.hs)) return;
    const psk = j.mode === "link" ? (this.linkKeys?.psk ?? null) : null;
    if (j.mode === "link" && !psk) return;
    const r = kx.joinerAnswer(j.mode, j.hs, m, psk);
    if (!r) return;
    j.result = r.result;
    j.host = from;
    this.sendKx(from, r.ans);
  }

  private async onKey(from: string, m: Extract<KxMsg, { k: "key" }>): Promise<void> {
    const j = this.joining;
    if (!j?.result || j.host !== from || !sameId(j.hs, m.hs) || this.keys) return;
    let link: LinkKeys;
    let bundle;
    try {
      bundle = await kx.openBundle(j.result, m);
      link = await deriveLink(bundle.link);
    } catch {
      return; // not sealed for this handshake: someone in the middle, or junk
    }
    // a link join must end up in the room it came to
    if (this.ended || this.joining !== j || (this.linkKeys && link.roomId !== this.linkKeys.roomId)) return;
    const key = await importRoomKey(bundle.key);
    if (this.ended || this.joining !== j) return;

    clearTimeout(this.kxTimer);
    const hs = toB64url(j.hs);
    const th = j.result.th;
    j.result.bundleKey.fill(0);
    this.joining = null;
    this.linkKeys?.psk.fill(0);
    this.link = bundle.link;
    this.linkKeys = link;
    this.roomKey = bundle.key;
    this.keys = { ...link, key };
    this.code = bundle.code ?? this.code;
    this.joinedVia = hs;
    this.update({ words: this.code ? codeWords(this.code) : null });

    if (j.mode === "code") {
      this.update({
        checks: [...this.view.checks, { hs, role: "joiner", peer: bundle.host || null, words: kx.safetyCode(th), state: "open" }],
        status: "connecting",
      });
      // from the lobby into the room itself
      this.connect();
      return;
    }
    await this.goLive();
  }

  // ---- key exchange: hosting ------------------------------------------------

  private canHost(): boolean {
    return !this.ended && this.keys !== null && this.roomKey !== null && this.link !== null && this.view.status === "live";
  }

  private onRequest(from: string, m: Extract<KxMsg, { k: "req" }>): void {
    const hs = toB64url(m.hs);
    if (!this.canHost() || this.handled.has(hs) || this.hosting.has(hs) || this.answerTimers.has(hs) || this.knockers.has(hs)) {
      return;
    }
    if (m.mode === "link") {
      // anyone holding the link can get the key; the psk in the exchange proves they hold it
      const [lo, hi] = ANSWER_DELAY_MS;
      const delay = this.owner ? 0 : lo + Math.random() * (hi - lo);
      this.answerTimers.set(
        hs,
        setTimeout(() => {
          this.answerTimers.delete(hs);
          if (!this.handled.has(hs) && this.canHost()) this.host(from, m.hs, "link");
        }, delay),
      );
      return;
    }
    // with the words, a person inside decides
    if (this.knockers.size >= MAX_LOBBY) return;
    const timer = setTimeout(() => this.dropKnock(hs), KNOCK_WAIT_MS);
    this.knockers.set(hs, { tag: from, hs: m.hs, timer });
    this.update({ knocks: [...this.view.knocks, { hs, at: Date.now() }] });
  }

  private dropKnock(hs: string): void {
    const k = this.knockers.get(hs);
    if (k) clearTimeout(k.timer);
    this.knockers.delete(hs);
    if (this.view.knocks.some((x) => x.hs === hs)) this.update({ knocks: this.view.knocks.filter((x) => x.hs !== hs) });
  }

  /** send an offer with fresh keys, and tell the others we've got this one */
  private host(tag: string, hsBytes: Bytes, mode: KxMode): void {
    const hs = toB64url(hsBytes);
    const keys = kx.hostKeys();
    const timer = setTimeout(() => {
      const h = this.hosting.get(hs);
      if (h) kx.wipeHost(h.keys);
      this.hosting.delete(hs);
    }, HOST_WAIT_MS);
    this.hosting.set(hs, { tag, hs: hsBytes, mode, keys, timer });
    this.handled.add(hs);
    this.sendKx(tag, { k: "offer", hs: hsBytes, x: keys.xPk, m: keys.mPk });
    void this.transmit({ v: 1, kind: "door", nick: this.view.nick, hs, act: "in", ts: Date.now() }).catch(() => false);
  }

  private async onAnswer(from: string, m: Extract<KxMsg, { k: "ans" }>): Promise<void> {
    const hs = toB64url(m.hs);
    const h = this.hosting.get(hs);
    if (!h || h.tag !== from) return;
    this.hosting.delete(hs);
    clearTimeout(h.timer);
    const psk = h.mode === "link" ? (this.linkKeys?.psk ?? null) : null;
    const r = psk || h.mode === "code" ? kx.hostAccept(h.mode, h.hs, h.keys, m, psk) : null;
    kx.wipeHost(h.keys);
    // a wrong MAC: they don't have the link
    if (!r || !this.canHost()) return;
    const sealed = await kx.sealBundle(r, h.hs, { key: this.roomKey!, link: this.link!, code: this.code, host: this.view.nick });
    r.bundleKey.fill(0);
    if (this.ended) return;
    this.sendKx(from, sealed);
    if (h.mode === "code") {
      this.update({ checks: [...this.view.checks, { hs, role: "host", peer: null, words: kx.safetyCode(r.th), state: "open" }] });
    }
  }

  private onError(code: ErrorCode): void {
    switch (code) {
      case "not_found":
        return this.end(this.view.entry === "code" && !this.keys ? NOTICES.noWords : NOTICES.not_found, "not_found");
      case "taken":
        // our fresh words point to another live room (or, vanishingly unlikely, the room id does): new words
        if (this.view.entry === "create" && !this.joined && ++this.wordTries <= WORD_TRIES) {
          this.code = newDoorCode();
          this.everLive = false;
          this.update({ words: codeWords(this.code) });
          this.retryTimer = setTimeout(() => this.connect(), 50);
          return;
        }
        return this.end(NOTICES.not_found, "not_found");
      case "gone":
        return this.end(this.everLive ? NOTICES.goneWhileAway : NOTICES.gone, "expired");
      case "full":
        return this.end(this.view.entry === "code" && !this.keys ? NOTICES.lobbyFull : NOTICES.full, "full");
      case "locked":
        return this.end(NOTICES.locked, "locked");
      case "limit":
        return this.end(NOTICES.limit, "limit");
      case "slow":
        // mid-room: back off to the slowest pace, the close that follows retries
        if (this.everLive && this.keys) {
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
    // a socket closed mid-exchange: the next hello starts a fresh one
    clearTimeout(this.kxTimer);
    this.joining?.result?.bundleKey.fill(0);
    this.joining = null;
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
    if (this.everLive && this.keys && this.view.status !== "reconnecting") this.update({ status: "reconnecting" });
    this.retryTimer = setTimeout(() => this.connect(), d.delayMs);
  }

  /** stop and wait for "try again", keeping what we came with (link, words, key) in memory */
  private pause(kind: "unreachable" | "nobody" = "unreachable", notice: string | null = null): void {
    this.paused = true;
    clearTimeout(this.kxTimer);
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.joining?.result?.bundleKey.fill(0);
    this.joining = null;
    this.connSeq++;
    this.conn?.close();
    this.conn = null;
    if (store.session === this) {
      store = { ...store, notice, error: kind };
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

  private async receive(sealed: Sealed): Promise<void> {
    if (!this.keys) {
      // not let in yet: keep it (encrypted) until we have the key
      if (this.pending.length < MAX_PENDING) this.pending.push(sealed);
      return;
    }
    let m: Inner | null;
    try {
      const o = await openMsg(this.keys.key, this.keys.aad, sealed);
      // a replayed frame: already seen this sender's counter
      if (!this.guard.accept(o.sender, o.counter)) return;
      m = decodeInner(o.plaintext);
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
      case "join": {
        this.push({ kind: "system", mine: false, nick: m.nick, text: `${m.nick} joined`, ts: m.ts });
        // put a name to the safety code of the person we let in
        const hs = m.hs;
        if (hs && this.view.checks.some((c) => c.hs === hs && c.role === "host")) {
          this.update({ checks: this.view.checks.map((c) => (c.hs === hs ? { ...c, peer: m.nick } : c)) });
        }
        return;
      }
      case "door": {
        // someone else inside has this one: don't answer it too
        this.handled.add(m.hs);
        clearTimeout(this.answerTimers.get(m.hs));
        this.answerTimers.delete(m.hs);
        this.dropKnock(m.hs);
        return;
      }
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
  const link = newSecret();
  const roomKey = crypto.getRandomValues(new Uint8Array(ROOM_KEY_BYTES));
  const ownerSecret = crypto.getRandomValues(new Uint8Array(32));
  const hash = toB64url(new Uint8Array(await crypto.subtle.digest("SHA-256", ownerSecret)));
  const [link_, key] = await Promise.all([deriveLink(link), importRoomKey(roomKey)]);
  const s = new Session({
    entry: "create",
    link,
    roomKey,
    link_,
    key,
    code: newDoorCode(),
    owner: { secret: ownerSecret, hash },
    ttl,
  });
  replace(s);
  navigate("/r");
  s.connect();
}

/**
 * Read the link secret from a `#fragment`. Returns false if it isn't a valid room link.
 * The link doesn't carry the room key: someone inside hands it over (see crypto/kx.ts).
 */
export async function joinFromFragment(fragment: string): Promise<boolean> {
  let link: Bytes;
  try {
    link = fromB64url(fragment);
  } catch {
    return false;
  }
  if (link.length !== SECRET_BYTES) return false;
  const s = new Session({ entry: "link", link, link_: await deriveLink(link) });
  replace(s);
  s.connect();
  return true;
}

/** knock with the room's 4 words */
export async function joinWithWords(code: DoorCode): Promise<void> {
  const s = new Session({ entry: "code", code });
  replace(s);
  s.connect();
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

function sameId(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** `online` / tab visible again */
export function wake(reason: "online" | "visible"): void {
  store.session?.wake(reason);
}

/** `offline` */
export function networkDown(): void {
  store.session?.networkDown();
}
