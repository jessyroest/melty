import { Fragment, type PointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { navigate } from "../../lib/router";
import { LiveMascot } from "../LiveMascot";
import { Frost } from "./Frost";
import { useInView, useReducedMotion } from "./hooks";

// ---- the end ----------------------------------------------------------------------

/**
 * Which letters drip. `x` is where to look for a stroke (0..1 of the glyph's advance),
 * `L` the drip length (em), `t` the cycle (s), `d` the delay (s). The exact spot is
 * measured from the rendered glyph, so drips always hang from a real stroke.
 */
const DRIPS: Record<number, { x: number; L: number; t: number; d: number }> = {
  1: { x: 0.85, L: 0.38, t: 6.4, d: 0.4 }, // a: right stem
  2: { x: 0.5, L: 0.55, t: 7.4, d: 2.2 }, // l
  3: { x: 0.85, L: 0.26, t: 8.4, d: 5.6 }, // k: right leg
  7: { x: 0.85, L: 0.7, t: 6.8, d: 1.0 }, // h: right leg
  9: { x: 0.15, L: 0.34, t: 7.8, d: 3.6 }, // n: left leg
  11: { x: 0.5, L: 0.46, t: 6.2, d: 4.8 }, // m: middle leg
  13: { x: 0.5, L: 0.78, t: 7.1, d: 0 }, // l
};

type Stroke = { x: number; w: number; bottom: number };

/** draw one glyph on a canvas and find the stroke nearest `hint` just above the baseline */
function findStroke(ch: string, font: string, size: number, hint: number): Stroke | null {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.font = font;
  const adv = ctx.measureText(ch).width;
  const pad = Math.ceil(size * 0.2);
  c.width = Math.ceil(adv + pad * 2);
  c.height = Math.ceil(size * 1.5);
  const base = Math.round(size * 1.1);
  ctx.font = font;
  ctx.fillText(ch, pad, base);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const ink = (x: number, y: number) => (data[(y * c.width + x) * 4 + 3] ?? 0) > 110;

  const runsAt = (row: number) => {
    const runs: [number, number][] = [];
    let start = -1;
    for (let x = 0; x <= c.width; x++) {
      const on = x < c.width && ink(x, row);
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        runs.push([start, x - 1]);
        start = -1;
      }
    }
    return runs;
  };
  // look for a clean vertical stroke near the hint, starting well above the baseline
  // (where bowls and stems are still apart) and working down
  const want = pad + hint * adv;
  for (const lift of [0.3, 0.22, 0.14, 0.07]) {
    const row = Math.round(base - size * lift);
    const near = runsAt(row).filter(([a, b]) => Math.abs((a + b) / 2 - want) < adv * 0.3 && b - a < size * 0.2);
    if (!near.length) continue;
    const [a, b] = near.reduce((best, r) => (Math.abs((r[0] + r[1]) / 2 - want) < Math.abs((best[0] + best[1]) / 2 - want) ? r : best));
    const cx = Math.round((a + b) / 2);
    let y = row;
    while (y < c.height - 1 && ink(cx, y + 1)) y++;
    return { x: (a + b + 1) / 2 - pad, w: b - a + 1, bottom: y + 1 - base };
  }
  return null;
}

export function DripText({ text }: { text: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const puddle = useRef<HTMLSpanElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  // words of letters, each letter remembering its index in the whole text
  const words = useMemo(() => {
    let i = 0;
    return text.split(" ").map((w) => {
      const out = [...w].map((ch) => ({ ch, i, drip: DRIPS[i++] }));
      i++;
      return out;
    });
  }, [text]);

  // place every drip under its stroke, and tell its drop how far it is to the puddle
  useLayoutEffect(() => {
    const root = wrap.current;
    if (!root) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const h2 = root.querySelector("h2");
      const pool = puddle.current;
      if (!h2 || !pool) return;
      const cs = getComputedStyle(h2);
      const size = parseFloat(cs.fontSize);
      const font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
      const surface = pool.getBoundingClientRect().top + pool.offsetHeight * 0.4;
      root.querySelectorAll<HTMLElement>(".drip-ch").forEach((el) => {
        const drip = el.querySelector<HTMLElement>(".drip");
        const probe = el.querySelector<HTMLElement>(".drip-probe");
        if (!drip || !probe) return;
        const hint = Number(el.dataset.hint);
        const L = Number(el.dataset.len);
        const s = findStroke(el.dataset.ch ?? "", font, size, hint);
        const y = probe.offsetTop + (s ? s.bottom - s.w * 0.28 : 0);
        if (s) {
          drip.style.setProperty("--x", `${s.x}px`);
          drip.style.setProperty("--y", `${y}px`);
          drip.style.setProperty("--w", `${Math.max(4, s.w)}px`);
        }
        const top = el.getBoundingClientRect().top + y;
        const fall = surface - top - L * 1.08 * size;
        // drips on an upper line would fall through the next one: they only ooze
        const upper = fall > size * 1.4;
        drip.classList.toggle("is-upper", upper);
        drip.style.setProperty("--L", `${upper ? Math.min(L, 0.26) : L}em`);
        drip.style.setProperty("--fall", `${Math.max(0, fall)}px`);
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    document.fonts?.ready.then(schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [words]);

  // no dripping off-screen
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOnScreen(!!e?.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className={`drip-wrap${onScreen ? "" : " is-paused"}`} ref={wrap}>
      <h2 className="drip-text" aria-label={text}>
        {words.map((w, wi) => (
          <Fragment key={wi}>
            {wi > 0 && " "}
            {wi === 1 && <span className="drip-br" aria-hidden="true" />}
            <span className="drip-word" aria-hidden="true">
              {w.map(({ ch, i, drip }) =>
                drip ? (
                  <span key={i} className="drip-ch" data-ch={ch} data-hint={drip.x} data-len={drip.L}>
                    {ch}
                    <i className="drip-probe" />
                    <span
                      className="drip"
                      style={{
                        ["--L" as string]: `${drip.L}em`,
                        ["--x" as string]: `${drip.x * 100}%`,
                        ["--t" as string]: `${drip.t}s`,
                        ["--d" as string]: `${drip.d}s`,
                      }}
                    >
                      <span className="drip__col" />
                      <span className="drip__bulb" />
                      <span className="drip__drop" />
                      <span className="drip__splash" />
                    </span>
                  </span>
                ) : (
                  ch
                ),
              )}
            </span>
          </Fragment>
        ))}
      </h2>
      <span className="drip-puddle" ref={puddle} aria-hidden="true">
        <svg viewBox="0 0 1000 30" preserveAspectRatio="none">
          <defs>
            <linearGradient id="drip-pool" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" className="drip-pool__edge" />
              <stop offset="0.18" className="drip-pool__mid" />
              <stop offset="0.82" className="drip-pool__mid" />
              <stop offset="1" className="drip-pool__edge" />
            </linearGradient>
          </defs>
          <path
            className="drip-puddle__pool"
            d="M8 16 C40 6 120 9 190 8 C260 7 300 4 380 6 C470 8 520 3 610 5 C700 7 760 4 850 7 C920 9 980 8 994 15 C985 24 900 25 820 23 C720 21 650 26 560 24 C470 22 400 27 300 24 C210 22 120 26 50 23 C20 22 4 20 8 16 Z"
          />
          <path className="drip-puddle__shine" d="M60 11 C200 8 330 7 430 9 M560 8 C660 7 760 8 900 10" />
        </svg>
      </span>
    </div>
  );
}

function LinkIcon() {
  return (
    <svg className="l-final__chain" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
    </svg>
  );
}

export function FinalCta({ onStart, onJoin }: { onStart: () => void; onJoin: () => void }) {
  const row = useRef<HTMLDivElement>(null);
  const seen = useInView(row, 0.4);
  const reduced = useReducedMotion();
  const [bump, setBump] = useState(0);
  const [bye, setBye] = useState(false);
  const lastHop = useRef(0);

  // a farewell: two hops and a line when the end scrolls into view
  useEffect(() => {
    if (!seen) return;
    setBye(true);
    const ts = [setTimeout(() => setBye(false), 4600)];
    if (!reduced) ts.push(setTimeout(() => setBump(1), 300), setTimeout(() => setBump(2), 850));
    return () => ts.forEach(clearTimeout);
  }, [seen, reduced]);

  const hop = () => {
    const now = performance.now();
    if (reduced || now - lastHop.current < 700) return;
    lastHop.current = now;
    setBump((b) => b + 1);
  };

  // the primary button leans a little towards the pointer
  const magnet = (e: PointerEvent<HTMLButtonElement>) => {
    if (reduced || e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width - 0.5) * 10}px`);
    el.style.setProperty("--my", `${((e.clientY - r.top) / r.height - 0.5) * 8}px`);
  };
  const unmagnet = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.style.setProperty("--mx", "0px");
    e.currentTarget.style.setProperty("--my", "0px");
  };

  return (
    <section className="l-final">
      <Frost density={0.5} />
      <div className="l-final__inner">
        <DripText text="talk. then melt." />
        <div className="l-final__row" ref={row}>
          <div>
            <div className="l-final__actions">
              <button
                className="btn btn--primary btn--big l-final__go"
                type="button"
                onClick={onStart}
                onPointerEnter={hop}
                onFocus={hop}
                onPointerMove={magnet}
                onPointerLeave={unmagnet}
              >
                <span className="l-final__sheen" aria-hidden="true" />
                <span className="l-final__label">open a room</span>
                <svg className="l-final__arrow" viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M3 10h13M11 5l5 5-5 5" />
                </svg>
                <span className="l-final__bdrips" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </button>
              <button className="btn btn--ghost btn--big l-final__join" type="button" onClick={onJoin}>
                <LinkIcon />
                <span>join with a link</span>
              </button>
            </div>
            <p className="mono l-final__fine">no account · end-to-end encrypted · up to 8 people</p>
          </div>
          <div className="l-final__cube">
            <span className={`l-final__bye${bye ? " is-on" : ""}`} aria-hidden="true">
              bye. i won't remember this.
            </span>
            <LiveMascot pokeable left={0.72} size={200} bump={bump} className="l-final__mascot" />
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- footer: the cube melts while you're here; click it to refreeze -----------------

const MELT_SECONDS = 300;

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function cubeLine(s: number): string {
  if (s < 20) return "fresh out of the freezer.";
  if (s < 90) return `you've been here ${clock(s)}. the cube noticed.`;
  if (s < MELT_SECONDS) return `${clock(s)} in. it's getting warm in here.`;
  return `${clock(s)}. it's mostly water now.`;
}

export function Footer() {
  const [secs, setSecs] = useState(0);
  const [bump, setBump] = useState(0);
  const left = Math.max(0.08, 1 - secs / MELT_SECONDS);

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) setSecs((s) => s + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const refreeze = () => {
    setSecs(0);
    setBump((b) => b + 1);
  };

  return (
    <footer className="l-footer" style={{ ["--gone" as string]: 1 - left }}>
      <div className="l-footer__inner">
        <div className="l-footer__brand">
          <button type="button" className="l-footer__cube" onClick={refreeze} aria-label="refreeze the ice cube">
            <LiveMascot size={64} left={left} bump={bump} />
          </button>
          <div>
            <span className="l-footer__name">melty</span>
            <span className="l-footer__tag">rooms that melt.</span>
          </div>
        </div>
        <nav className="l-footer__nav" aria-label="footer">
          <a
            href="/how"
            onClick={(e) => {
              e.preventDefault();
              navigate("/how");
            }}
          >
            how it works
          </a>
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
            }}
          >
            back to top
          </a>
        </nav>
        <p className="mono l-footer__promise">no cookies · no analytics · the relay keeps no logs</p>
        <p className="mono l-footer__clock">
          <span aria-hidden="true">{cubeLine(secs)} </span>
          <span className="l-footer__hint">{secs >= 20 ? "click the cube to refreeze." : ""}</span>
        </p>
      </div>
      <span className="l-footer__word" aria-hidden="true">
        melty
      </span>
    </footer>
  );
}
