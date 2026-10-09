import {
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LiveMascot } from "../LiveMascot";
import { useReducedMotion } from "./hooks";

// ---- "things melty never asks for": the list is pinned and each line melts as you scroll ----
// Scroll drives everything (one rAF), so scrolling back up refreezes it.

const NEVER = [
  "an email address.",
  "a phone number.",
  "a username.",
  "a password.",
  "your real name.",
];
const START = 0.06; // track progress where the first line starts to melt
const STEP = 0.14; // offset between lines
const SPAN = 0.3; // track progress one line needs to melt completely
const LAND = 0.9; // "you just talk." lands here

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** small seeded PRNG so every visit melts the same way */
function seeded(text: string) {
  let s = 7;
  for (const ch of text) s = (s * 31 + ch.charCodeAt(0)) % 2147483647;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

type Drip = { at: number; o: number; len: number };

function NeverLine({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [xs, setXs] = useState<number[]>([]);

  const { chars, drips } = useMemo(() => {
    const r = seeded(text);
    const chars = [...text].map((ch, i) => ({
      ch,
      // mostly random, with a slight left-to-right wave
      o: r() * 0.28 + (i / text.length) * 0.12,
      s: 0.3 + r() * 0.8,
      x: (r() - 0.5) * 0.1,
      r: (r() - 0.5) * 12,
    }));
    // a drip under roughly every fourth letter, never under a space
    const drips: Drip[] = [];
    chars.forEach((c, i) => {
      if (c.ch === " " || c.ch === ".") return;
      if (i % 4 === 1 || (i === chars.length - 2 && drips.length < 3)) {
        drips.push({ at: i, o: 0.04 + r() * 0.3, len: 0.35 + r() * 0.25 });
      }
    });
    return { chars, drips };
  }, [text]);

  // drips hang under real letters, so measure where those letters are. Only from the
  // ResizeObserver (it fires once right after layout, for every line in the same frame) and
  // when the font arrives: measuring synchronously on mount forced a full-page layout per line.
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = () => {
      const els = box.querySelectorAll<HTMLElement>(".nv-ch");
      const next = drips.map((d) => (els[d.at] ? els[d.at]!.offsetLeft + els[d.at]!.offsetWidth / 2 : 0));
      setXs((prev) => (prev.length === next.length && prev.every((x, i) => x === next[i]) ? prev : next));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [drips]);

  return (
    <li className="nv-line">
      <span className="sr-only">{text}</span>
      <span ref={ref} className="nv-melt" aria-hidden="true">
        {chars.map((c, i) => (
          <span
            key={i}
            className={c.ch === " " ? "nv-ch nv-ch--sp" : "nv-ch"}
            style={{
              ["--o" as string]: c.o.toFixed(3),
              ["--s" as string]: c.s.toFixed(3),
              ["--x" as string]: `${c.x.toFixed(3)}em`,
              ["--r" as string]: `${c.r.toFixed(1)}deg`,
            }}
          >
            <span className="nv-glyph">{c.ch === " " ? " " : c.ch}</span>
          </span>
        ))}
        {/* drips and puddle share a goo filter, so they flow into each other like liquid */}
        <span className="nv-goo">
          <span className="nv-pool" />
          {xs.length === drips.length &&
            drips.map((d, k) => (
              <span
                key={k}
                className="nv-drip"
                style={{
                  left: xs[k],
                  ["--o" as string]: d.o.toFixed(3),
                  ["--len" as string]: d.len.toFixed(3),
                }}
              >
                <span className="nv-drip__neck" />
                <span className="nv-drip__drop" />
                <span className="nv-drip__blob" />
              </span>
            ))}
        </span>
      </span>
    </li>
  );
}

/** pins the list and writes each line's melt progress (--m) straight to the DOM */
function useNeverScroll(track: RefObject<HTMLDivElement | null>) {
  const [landed, setLanded] = useState(false);
  const [lands, setLands] = useState(0);
  const [goo, setGoo] = useState(3);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const lines = [...el.querySelectorAll<HTMLElement>(".nv-line")];
    let frame = 0;
    let on = false;
    let wasLanded = false;

    const measure = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const span = r.height - innerHeight;
      const q = span <= 0 ? 1 : clamp01(-r.top / span);
      lines.forEach((li, i) => {
        const m = clamp01((q - START - i * STEP) / SPAN).toFixed(3);
        if (li.dataset.m !== m) {
          li.dataset.m = m;
          li.style.setProperty("--m", m);
        }
      });
      const l = q >= LAND;
      if (l !== wasLanded) {
        wasLanded = l;
        setLanded(l);
        if (l) setLands((n) => n + 1);
      }
    };
    const onScroll = () => {
      if (on && !frame) frame = requestAnimationFrame(measure);
    };
    const onResize = () => {
      const fs = parseFloat(getComputedStyle(lines[0] ?? el).fontSize) || 60;
      setGoo(Math.max(1.4, Math.round(fs * 0.05 * 10) / 10));
      onScroll();
    };
    const io = new IntersectionObserver(([e]) => {
      on = !!e?.isIntersecting;
      if (on) measure();
    });
    io.observe(el);
    onResize();
    measure();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onResize);
    return () => {
      io.disconnect();
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
    };
  }, [track]);

  return { landed, lands, goo };
}

export function NeverAsk() {
  const track = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { landed, lands, goo } = useNeverScroll(track);

  return (
    <section className="l-section l-never">
      {/* the goo filter melts drips and puddles into one liquid shape */}
      <svg
        className="nv-defs"
        width="0"
        height="0"
        aria-hidden="true"
        focusable="false"
      >
        <filter
          id="nv-goo"
          x="-20%"
          y="-50%"
          width="140%"
          height="200%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation={goo} result="blur" />
          <feColorMatrix
            in="blur"
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10"
          />
        </filter>
      </svg>
      <div className="l-never__intro">
        <h2 className="h-xl">
          no sign-up.
          <br />
          no strings.
        </h2>
        <p className="lead">
          most apps want to know who you are before you can say a word. melty
          skips that part. open a room, share the link, you're in.
        </p>
      </div>
      <div ref={track} className="nv-track">
        <div className={`nv-stick${landed ? " is-landed" : ""}`}>
          <p className="nv-label mono">things melty never asks for ↓</p>
          <ul className="nv-list">
            {NEVER.map((t) => (
              <NeverLine key={t} text={t} />
            ))}
          </ul>
          <p className={`nv-end${landed ? " is-landed" : ""}`}>
            <span className="nv-end__words">you just talk.</span>
            <LiveMascot
              size={96}
              className="nv-end__cube"
              bump={reduced ? 0 : lands}
            />
            <span className="nv-end__splash" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
