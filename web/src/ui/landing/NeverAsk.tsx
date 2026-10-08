import { useEffect, useMemo, useRef, useState } from "react";
import { useInView } from "./hooks";

// ---- "things melty never asks for": each line melts away when it scrolls in ----

const NEVER = ["an email address.", "a phone number.", "a username.", "a password.", "your real name."];

function MeltLine({ text, delay }: { text: string; delay: number }) {
  const ref = useRef<HTMLLIElement>(null);
  const seen = useInView(ref, 0.9);
  const [melting, setMelting] = useState(false);
  const chars = useMemo(
    () =>
      [...text].map((ch) => ({
        ch,
        d: Math.round(Math.random() * 700),
        x: (Math.random() - 0.5) * 0.12,
        s: 1.25 + Math.random() * 0.7,
      })),
    [text],
  );

  useEffect(() => {
    if (!seen) return;
    const t = setTimeout(() => setMelting(true), 500 + delay);
    return () => clearTimeout(t);
  }, [seen, delay]);

  return (
    <li ref={ref} className={`melt-line${melting ? " is-melting" : ""}`} aria-label={text}>
      <span className="melt-line__text" aria-hidden="true">
        {chars.map((c, i) => (
          <span
            key={i}
            className="melt-ch"
            style={{ ["--d" as string]: `${c.d}ms`, ["--x" as string]: `${c.x}em`, ["--s" as string]: c.s }}
          >
            {c.ch === " " ? " " : c.ch}
          </span>
        ))}
      </span>
      <span className="melt-line__puddle" aria-hidden="true" />
    </li>
  );
}

export function NeverAsk() {
  return (
    <section className="l-section l-never">
      <div className="l-never__intro">
        <h2 className="h-xl">
          no sign-up.
          <br />
          no strings.
        </h2>
        <p className="lead">
          most apps want to know who you are before you can say a word. melty skips that part. open a room, share the
          link, you're in.
        </p>
        <p className="mono muted">things melty never asks for ↓</p>
      </div>
      <ul className="l-never__list">
        {NEVER.map((t, i) => (
          <MeltLine key={t} text={t} delay={i * 380} />
        ))}
      </ul>
      <p className="l-never__end h-lg">you just talk.</p>
    </section>
  );
}
