import { type RefObject, useEffect, useRef, useState } from "react";
import { LiveMascot } from "../LiveMascot";
import { useInView, useReducedMotion } from "./hooks";
import { UsesEdge, UsesFrost } from "./UsesDecor";

// ---- the ice-blue section ---------------------------------------------------------

/** [what, ttl in seconds, spoken ttl] */
const USES: [string, number, string][] = [
  ["a plan with people you just met.", 600, "10 minutes"],
  ["sorting out something sensitive.", 3600, "1 hour"],
  ["a group chat for one evening.", 86400, "24 hours"],
  ["a question you'd rather not have archived.", 600, "10 minutes"],
  ["talking without swapping phone numbers.", 3600, "1 hour"],
];

const QUOTE = ["“just", "between", "us.”"];

function fmt(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** true while the element is on screen */
function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOn(!!e?.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return on;
}

/** the giant quote: letters condense out of the frost, one by one */
function FrostQuote({ seen }: { seen: boolean }) {
  let n = 0;
  return (
    <p className={`l-uses__quote${seen ? " is-in" : ""}`} aria-hidden="true">
      {QUOTE.map((w) => (
        <span className="l-uses__word" key={w}>
          {[...w].map((ch, i) => (
            <span className="l-uses__ch" key={i} style={{ ["--n" as string]: n++ }}>
              {ch}
            </span>
          ))}
        </span>
      ))}
    </p>
  );
}

/** a row's ttl: a tiny ring plus a clock that runs down (5x speed) while the row is live */
function Ttl({ total, live, spoken }: { total: number; live: boolean; spoken: string }) {
  const [left, setLeft] = useState(total);
  // a row that stops being live starts over from the full time next round
  const [wasLive, setWasLive] = useState(live);
  if (live !== wasLive) {
    setWasLive(live);
    if (!live) setLeft(total);
  }
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      if (!document.hidden) setLeft((s) => (s > 1 ? s - 1 : total));
    }, 200);
    return () => clearInterval(id);
  }, [live, total]);
  // the ring shows the last minute running out, so the movement is visible
  const sweep = (left % 60) / 60 || 1;
  return (
    <span className="l-uses__ttl">
      <svg className="l-uses__ring" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="7.5" />
        <circle cx="10" cy="10" r="7.5" pathLength={1} style={{ strokeDashoffset: live ? 1 - sweep : 0 }} />
      </svg>
      <span className="mono" aria-hidden="true">
        {fmt(left)}
      </span>
      <span className="sr-only">melts after {spoken}</span>
    </span>
  );
}

export function UseCases() {
  const ref = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const seen = useInView(ref, 0.2);
  const onScreen = useOnScreen(section);
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<number | null>(null);
  const [auto, setAuto] = useState(0);

  // without a pointer on it, the live row wanders down the list by itself
  useEffect(() => {
    if (!onScreen || hover !== null || reduced) return;
    const id = setInterval(() => {
      if (!document.hidden) setAuto((i) => (i + 1) % USES.length);
    }, 3400);
    return () => clearInterval(id);
  }, [onScreen, hover, reduced]);

  const live = hover ?? (onScreen && !reduced ? auto : -1);

  return (
    <section className="l-uses" ref={section}>
      <UsesEdge side="top" />
      <UsesFrost seen={seen} />
      <div className="l-uses__inner" ref={ref}>
        <FrostQuote seen={seen} />
        <div className="l-uses__grid">
          <div className="l-uses__intro">
            <h2 className="h-lg">for the conversations that don't need a transcript.</h2>
            <p>not every chat has to live forever in somebody's cloud.</p>
            <p>not everyone you talk to needs to end up in your contacts.</p>
          </div>
          <ul className={`l-uses__list${seen ? " is-in" : ""}`} onPointerLeave={() => setHover(null)}>
            {USES.map(([t, ttl, spoken], i) => (
              <li
                key={t}
                className={live === i ? "is-live" : undefined}
                style={{ ["--i" as string]: i }}
                onPointerEnter={() => setHover(i)}
              >
                <span className="l-uses__what">{t}</span>
                <Ttl total={ttl} live={live === i} spoken={spoken} />
              </li>
            ))}
          </ul>
          <div className="l-uses__foot">
            <LiveMascot left={0.86} size={116} className="l-uses__mascot" />
            <p className="mono">
              <span className="l-uses__shh" aria-hidden="true">
                shh.
              </span>
              if it matters, write it down. melty won't.
            </p>
          </div>
        </div>
      </div>
      <UsesEdge side="bottom" />
    </section>
  );
}
