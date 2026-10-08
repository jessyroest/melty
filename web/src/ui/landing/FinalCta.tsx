import { useMemo } from "react";
import { navigate } from "../../lib/router";
import { LiveMascot } from "../LiveMascot";
import { Frost } from "./Frost";

// ---- the end ----------------------------------------------------------------------

/** which letters drip, where (x % of the letter width) and how far (em); hand-placed under strokes */
const DRIPS: Record<number, { x: number; h: number; d: number }> = {
  1: { x: 18, h: 0.55, d: 0.2 }, // a
  2: { x: 40, h: 0.3, d: 1.6 }, // l
  7: { x: 78, h: 0.75, d: 0.9 }, // h
  9: { x: 70, h: 0.35, d: 2.4 }, // n
  12: { x: 12, h: 0.5, d: 1.2 }, // m
  14: { x: 42, h: 0.9, d: 0.5 }, // l
};

function DripText({ text }: { text: string }) {
  const letters = useMemo(() => [...text].map((ch, i) => ({ ch, drip: DRIPS[i] })), [text]);
  return (
    <h2 className="drip-text" aria-label={text}>
      {letters.map((l, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={l.drip ? "drip" : undefined}
          style={
            l.drip
              ? { ["--h" as string]: `${l.drip.h}em`, ["--x" as string]: `${l.drip.x}%`, ["--dd" as string]: `${l.drip.d}s` }
              : undefined
          }
        >
          {l.ch === " " ? " " : l.ch}
        </span>
      ))}
    </h2>
  );
}

export function FinalCta({ onStart, onJoin }: { onStart: () => void; onJoin: () => void }) {
  return (
    <section className="l-final">
      <Frost density={0.5} />
      <div className="l-final__inner">
        <DripText text="talk. then melt." />
        <div className="l-final__row">
          <div className="l-final__actions">
            <button className="btn btn--primary btn--big" type="button" onClick={onStart}>
              open a room
            </button>
            <button className="btn btn--ghost btn--big" type="button" onClick={onJoin}>
              join with a link
            </button>
          </div>
          <LiveMascot pokeable left={0.72} size={200} className="l-final__mascot" />
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="l-footer">
      <span className="l-footer__brand">
        <LiveMascot size={28} /> melty
      </span>
      <span className="mono muted">no cookies · no analytics · no logs</span>
      <a
        href="/how"
        onClick={(e) => {
          e.preventDefault();
          navigate("/how");
        }}
      >
        how it works
      </a>
    </footer>
  );
}
