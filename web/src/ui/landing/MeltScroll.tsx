import { useRef } from "react";
import { LiveMascot } from "../LiveMascot";
import { useScrollProgress } from "./hooks";

// ---- sticky scroll: the cube melts as you scroll, the clock runs down -------------

const MELT_END = 0.85; // scroll progress at which the clock hits zero
const STEPS = [
  { at: 0, text: "a fresh room. invite people with a link or a QR code." },
  { at: 0.21, text: "talk. every message is encrypted on your device before it leaves." },
  { at: 0.55, text: "the cube starts sweating. so does the clock." },
  { at: MELT_END, text: "time's up. the relay closes the room and wipes it. every browser drops the key." },
  { at: 0.95, text: "nothing left to recover. that's the point." },
];

function clockAt(p: number): string {
  const secs = Math.round(600 * (1 - Math.min(1, p / MELT_END)));
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
}

export function MeltScroll() {
  const ref = useRef<HTMLElement>(null);
  const p = useScrollProgress(ref);
  const t = Math.min(1, p / MELT_END);
  const left = 1 - t;
  const clock = clockAt(p);
  const active = STEPS.reduce((acc, s, i) => (p >= s.at ? i : acc), 0);

  return (
    <section ref={ref} className="l-melt" aria-label="what happens to a room">
      <div className="l-melt__sticky">
        <div className="l-melt__stage">
          <p className="l-melt__clock mono" aria-hidden="true">
            {clock}
          </p>
          <LiveMascot left={left} size={320} className="l-melt__mascot" />
          <div className="l-melt__water" style={{ transform: `scaleY(${t})` }} aria-hidden="true" />
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
    </section>
  );
}
