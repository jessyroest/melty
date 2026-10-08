import { type CSSProperties, useRef } from "react";
import { LiveMascot } from "../LiveMascot";
import { useScrollProgress } from "./hooks";

// ---- sticky scroll: the cube melts as you scroll, the clock runs down -------------
// Scroll progress goes into CSS variables (--p, --t, --q); the stage derives everything from them.

const MELT_END = 0.85; // scroll progress at which the clock hits zero
const STEPS = [
  { at: 0, text: "a fresh room. invite people with a link or a QR code." },
  { at: 0.21, text: "talk. every message is encrypted on your device before it leaves." },
  { at: 0.55, text: "the cube starts sweating. so does the clock." },
  { at: MELT_END, text: "time's up. the relay closes the room and wipes it. every browser drops the key." },
  { at: 0.95, text: "nothing left to recover. that's the point." },
];

// a tiny chat that shows up early and melts away as time runs out (a = appears at p, b = melts at t)
const BUBBLES = [
  { text: "you up?", me: false, a: 0.03, b: 0.34 },
  { text: "yes. what's up", me: true, a: 0.08, b: 0.44 },
  { text: "ok don't screenshot this", me: false, a: 0.14, b: 0.54 },
  { text: "never do", me: true, a: 0.2, b: 0.64 },
  { text: "see you at 8", me: false, a: 0.26, b: 0.74 },
];

// drips fall off the shelf edges; each starts once the cube is warm enough (th = t)
const DRIPS = [
  { x: -41, th: 0.1, dur: 2.3, delay: 0 },
  { x: 39, th: 0.22, dur: 2.7, delay: 0.9 },
  { x: -33, th: 0.4, dur: 1.9, delay: 0.4 },
  { x: 44, th: 0.55, dur: 1.6, delay: 1.3 },
  { x: -45, th: 0.7, dur: 1.3, delay: 0.7 },
];

function clockAt(p: number): string {
  const secs = Math.round(600 * (1 - Math.min(1, p / MELT_END)));
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

const v = (o: Record<string, string | number>) => o as CSSProperties;

export function MeltScroll() {
  const ref = useRef<HTMLElement>(null);
  const p = useScrollProgress(ref);
  const t = Math.min(1, p / MELT_END);
  const q = Math.min(1, Math.max(0, (p - MELT_END) / 0.07)); // the room goes quiet
  const left = 1 - t;
  const clock = clockAt(p);
  const active = STEPS.reduce((acc, s, i) => (p >= s.at ? i : acc), 0);

  return (
    <section
      ref={ref}
      className="l-melt"
      aria-label="what happens to a room"
      style={v({ "--p": p.toFixed(4), "--t": t.toFixed(4), "--q": q.toFixed(3) })}
    >
      <div className="l-melt__sticky">
        <div className={`l-melt__stage${q >= 1 ? " is-quiet" : ""}`}>
          <div className="l-melt__warm" aria-hidden="true" />
          <div className="l-melt__hush" aria-hidden="true" />

          <p className="l-melt__clock mono" aria-hidden="true">
            {clock}
          </p>

          <div className="l-melt__chat" aria-hidden="true">
            {BUBBLES.map((b) => (
              <span key={b.text} className={`l-melt__bubble${b.me ? " is-me" : ""}`} style={v({ "--a": b.a, "--b": b.b })}>
                {b.text}
              </span>
            ))}
          </div>
          <p className="l-melt__gone mono" aria-hidden="true">
            no messages. no key. no room.
          </p>

          <div className="l-melt__water" aria-hidden="true">
            <svg className="l-melt__wave" viewBox="0 0 400 16" preserveAspectRatio="none">
              <path d="M0 8 Q25 0 50 8 T100 8 T150 8 T200 8 T250 8 T300 8 T350 8 T400 8 V16 H0 Z" />
            </svg>
            <svg className="l-melt__wave l-melt__wave--back" viewBox="0 0 400 16" preserveAspectRatio="none">
              <path d="M0 8 Q25 0 50 8 T100 8 T150 8 T200 8 T250 8 T300 8 T350 8 T400 8 V16 H0 Z" />
            </svg>
            {DRIPS.map((d, i) => (
              <span
                key={i}
                className="l-melt__ripple"
                style={v({ "--x": d.x, "--th": d.th, "--dur": `${d.dur}s`, "--delay": `${d.delay}s` })}
              />
            ))}
          </div>

          <div className="l-melt__cube">
            <LiveMascot left={left} size={320} className="l-melt__mascot" />
            <span className="l-melt__shelf" aria-hidden="true" />
            {DRIPS.map((d, i) => (
              <span
                key={i}
                className="l-melt__drip"
                aria-hidden="true"
                style={v({ "--x": d.x, "--th": d.th, "--dur": `${d.dur}s`, "--delay": `${d.delay}s` })}
              >
                <span className="l-melt__drip-fall">
                  <i />
                </span>
              </span>
            ))}
          </div>
        </div>

        <div className="l-melt__side">
          <div className="l-melt__bar" aria-hidden="true">
            <span style={{ transform: `scaleX(${p})` }} />
          </div>
          <ol className="l-melt__steps">
            {STEPS.map((s, i) => (
              <li key={i} className={i === active ? "is-active" : i < active ? "is-past" : ""}>
                <span className="mono">{i === STEPS.length - 1 ? "steam" : clockAt(s.at)}</span>
                {s.text}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
