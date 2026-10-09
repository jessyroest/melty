import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Mascot, type Mood } from "./Mascot";

const LINES = [
  "brr.",
  "cold hands, warm heart.",
  "say it before i melt.",
  "i forget everything. on purpose.",
  "don't leave me in the sun.",
  "careful, i'm mostly water.",
  "nothing to see here. literally.",
  "poke me again and i'll drip on you.",
  "the key stays in the link.",
  "that tickles. a little.",
  "still frozen. for now.",
  "i don't keep receipts.",
];
const COMBO_LINES = ["ok. i see snowflakes.", "you cracked me. thanks.", "i'm fine. mostly.", "that's a lot of poking."];

const IDLE_MS = 15000;
const FAST = 2.4; // px per ms that counts as a whoosh
const ZERO = { x: 0, y: 0 };
const SAFE_TOP = 72; // room for a sticky header

/* ---- one shared pointer hub: one set of passive listeners, one rAF for every cube ---- */

type PointerSub = (x: number, y: number, speed: number) => void;
type SleepSub = (asleep: boolean) => void;

const pointerSubs = new Set<PointerSub>();
const sleepSubs = new Set<SleepSub>();
let px = NaN;
let py = NaN;
let lastT = 0;
let speed = 0;
let frame = 0;
let lastActive = 0;
let asleep = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  frame = 0;
  for (const s of pointerSubs) s(px, py, speed);
}
function schedule() {
  if (!frame) frame = requestAnimationFrame(flush);
}
function checkIdle() {
  const rest = IDLE_MS - (performance.now() - lastActive);
  if (rest > 50) {
    idleTimer = setTimeout(checkIdle, rest);
    return;
  }
  asleep = true;
  for (const s of sleepSubs) s(true);
}
function activity() {
  lastActive = performance.now();
  if (!asleep) return;
  asleep = false;
  for (const s of sleepSubs) s(false);
  idleTimer = setTimeout(checkIdle, IDLE_MS);
}
function onMove(e: PointerEvent) {
  const dt = e.timeStamp - lastT;
  // a pause resets the speed; otherwise smooth it a little
  speed = lastT && dt > 0 && dt < 120 ? speed * 0.4 + (Math.hypot(e.clientX - px, e.clientY - py) / dt) * 0.6 : 0;
  px = e.clientX;
  py = e.clientY;
  lastT = e.timeStamp;
  activity();
  schedule();
}
function onLeave() {
  px = NaN;
  py = NaN;
  speed = 0;
  schedule();
}
const events = ["pointerdown", "keydown", "scroll", "wheel"] as const;

function subscribe(p: PointerSub, s: SleepSub): () => void {
  if (pointerSubs.size === 0) {
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    for (const ev of events) window.addEventListener(ev, activity, { passive: true });
    lastActive = performance.now();
    asleep = false;
    idleTimer = setTimeout(checkIdle, IDLE_MS);
  }
  pointerSubs.add(p);
  sleepSubs.add(s);
  return () => {
    pointerSubs.delete(p);
    sleepSubs.delete(s);
    if (pointerSubs.size > 0) return;
    window.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerleave", onLeave);
    for (const ev of events) window.removeEventListener(ev, activity);
    cancelAnimationFrame(frame);
    frame = 0;
    clearTimeout(idleTimer);
  };
}

/* ---- the cube ---------------------------------------------------------------- */

type Anim = "" | "squish" | "squish2" | "hop" | "spin" | "shiver";

type Props = {
  left?: number;
  size?: number;
  className?: string;
  /** clickable: squish + a line of dialogue (poke it five times quickly for a surprise) */
  pokeable?: boolean;
  /** change this value to make the cube hop once */
  bump?: unknown;
  /** resting face; reactions (pokes, hover, sleep) still play over it */
  mood?: Mood;
};

/** The mascot, alive: eyes follow the pointer, it blinks, winks, dozes off, hops and can be poked. */
export function LiveMascot({ left = 1, size = 120, className, pokeable = false, bump, mood: baseMood }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [look, setLook] = useState(ZERO);
  const [blink, setBlink] = useState(false);
  const [sleeping, setSleeping] = useState(() => asleep);
  const [hover, setHover] = useState(false);
  const [reaction, setReaction] = useState<Mood | null>(null);
  const [crack, setCrack] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  // the last line stays put while the bubble fades out
  const [said, setSaid] = useState("");
  const [shift, setShift] = useState({ x: 0, y: 0 });
  const [anim, setAnim] = useState<Anim>("");
  const [tilt, setTilt] = useState(0);
  const [firstLine] = useState(() => Math.floor(Math.random() * LINES.length));
  const lineIdx = useRef(firstLine);
  const pokes = useRef<number[]>([]);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const tokens = useRef({ reaction: 0, anim: 0 });
  const startledAt = useRef(0);
  const hovering = useRef(false);
  // what the timers and pointer callbacks need to know right now
  const now = useRef({ sleeping, reaction });
  useLayoutEffect(() => {
    now.current = { sleeping, reaction };
  });

  function later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }
  function react(m: Mood, ms: number) {
    const tk = ++tokens.current.reaction;
    setReaction(m);
    later(() => tk === tokens.current.reaction && setReaction(null), ms);
  }
  function play(a: Anim, ms: number) {
    const tk = ++tokens.current.anim;
    setAnim(a);
    later(() => tk === tokens.current.anim && setAnim(""), ms);
  }

  useEffect(() => {
    const all = timers.current;
    return () => {
      for (const t of all) clearTimeout(t);
      all.clear();
    };
  }, []);

  // eyes follow the pointer; a fast whoosh nearby gives it a fright; idle sends it to sleep
  useEffect(() => {
    const onPointer: PointerSub = (x, y, v) => {
      const el = ref.current;
      if (!el) return;
      if (Number.isNaN(x)) {
        setLook(ZERO);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight || r.width === 0) return;
      const dx = x - (r.left + r.width / 2);
      const dy = y - (r.top + r.height * 0.55);
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, d / 220);
      const next = { x: (dx / d) * reach, y: (dy / d) * reach };
      setLook((prev) => (Math.abs(prev.x - next.x) + Math.abs(prev.y - next.y) < 0.02 ? prev : next));

      const t = performance.now();
      // a whoosh past it, not onto it (and not in the middle of another reaction)
      if (v > FAST && !hovering.current && !now.current.reaction && d < Math.max(150, r.width * 1.2) && t - startledAt.current > 3000) {
        startledAt.current = t;
        react("wide", 900);
        play("shiver", 650);
      }
    };
    const onSleep: SleepSub = (s) => {
      setSleeping(s);
      if (!s) {
        react("surprised", 450);
        play("hop", 500);
      }
    };
    return subscribe(onPointer, onSleep);
    // react/play only touch refs and state setters: subscribing once, on mount, is the point
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // blink every few seconds, sometimes twice, now and then a wink
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      t = setTimeout(
        () => {
          const roll = Math.random();
          if (now.current.sleeping || now.current.reaction) {
            // eyes are busy
          } else if (roll < 0.1) {
            react("wink", 520);
          } else {
            setBlink(true);
            later(() => setBlink(false), 130);
            if (roll > 0.75) {
              later(() => setBlink(true), 260);
              later(() => setBlink(false), 390);
            }
          }
          next();
        },
        2200 + Math.random() * 4000,
      );
    };
    next();
    return () => clearTimeout(t);
    // one blink loop for the component's life; react() only touches refs and setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // hop when `bump` changes (skip the first render)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    play("hop", 520);
    // only a new bump should hop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bump]);

  // the last line stays put while the bubble fades out
  if (line && line !== said) setSaid(line);
  useEffect(() => {
    if (!line) return;
    const t = setTimeout(() => setLine(null), 2600);
    return () => clearTimeout(t);
  }, [line]);

  // keep the bubble inside the viewport (phones, cubes near an edge, under a sticky header)
  useLayoutEffect(() => {
    const b = bubbleRef.current;
    const host = b?.parentElement;
    if (!b || !host || !line) return;
    const r = host.getBoundingClientRect();
    const half = b.offsetWidth / 2;
    const mid = r.left + r.width / 2;
    const vw = document.documentElement.clientWidth;
    const pad = 12;
    const lo = pad + half - mid;
    const hi = vw - pad - half - mid;
    const x = lo > hi ? 0 : Math.min(hi, Math.max(lo, 0));
    const top = r.top + r.height * 0.21 - b.offsetHeight - 8;
    const y = Math.min(r.height * 0.3, Math.max(0, SAFE_TOP - top));
    setShift({ x, y });
  }, [line]);

  function poke(e: MouseEvent<HTMLButtonElement>) {
    const now = performance.now();
    startledAt.current = Math.max(startledAt.current, now - 2000);
    pokes.current = [...pokes.current.filter((t) => now - t < 2400), now];

    // lean away from the finger (keyboard presses land in the middle)
    if (e.detail > 0) {
      const r = e.currentTarget.getBoundingClientRect();
      const off = (e.clientX - (r.left + r.width / 2)) / (r.width / 2 || 1);
      setTilt(Math.max(-1, Math.min(1, off)) * -9);
    } else {
      setTilt(0);
    }

    if (pokes.current.length >= 5) {
      pokes.current = [];
      setLine(COMBO_LINES[Math.floor(Math.random() * COMBO_LINES.length)]!);
      react("dizzy", 2600);
      play("spin", 950);
      setCrack(true);
      later(() => setCrack(false), 3200);
      return;
    }

    lineIdx.current = (lineIdx.current + 1 + Math.floor(Math.random() * 3)) % LINES.length;
    setLine(LINES[lineIdx.current]!);
    react(pokes.current.length === 3 ? "wink" : "surprised", 620);
    play(anim === "squish" ? "squish2" : "squish", 720);
  }

  const mood: Mood = reaction ?? (hover ? "squint" : sleeping ? "sleepy" : (baseMood ?? "happy"));
  const breathe = sleeping && !anim && !reaction;

  const body = (
    <span
      ref={ref}
      className={`live-mascot${sleeping ? " live-mascot--asleep" : ""}`}
      onPointerEnter={(e) => {
        hovering.current = true;
        if (e.pointerType === "mouse") setHover(true);
      }}
      onPointerLeave={() => {
        hovering.current = false;
        setHover(false);
      }}
    >
      <span
        className={`live-mascot__squash${anim ? ` live-mascot__squash--${anim}` : breathe ? " live-mascot__squash--breathe" : ""}`}
        style={{ ["--tilt" as string]: `${tilt}deg` }}
      >
        <Mascot left={left} size={size} look={look} blink={blink} mood={mood} crack={crack} />
      </span>
    </span>
  );

  if (!pokeable) return <span className={className}>{body}</span>;
  return (
    <span className={`poke ${className ?? ""}`}>
      <button type="button" className="poke__btn" onClick={poke} aria-label="poke the ice cube">
        {body}
      </button>
      <span
        ref={bubbleRef}
        className={`cube-bubble${line ? " is-on" : ""}`}
        style={{ ["--shift" as string]: `${shift.x}px`, ["--drop" as string]: `${shift.y}px` }}
        role="status"
      >
        {line ?? said}
      </span>
    </span>
  );
}
