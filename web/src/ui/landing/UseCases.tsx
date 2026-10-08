import { useRef } from "react";
import { useInView } from "./hooks";

// ---- the ice-blue section ---------------------------------------------------------

const USES: [string, string][] = [
  ["a plan with people you just met.", "10:00"],
  ["sorting out something sensitive.", "1:00:00"],
  ["a group chat for one evening.", "24:00:00"],
  ["a question you'd rather not have archived.", "10:00"],
  ["talking without swapping phone numbers.", "1:00:00"],
];

export function UseCases() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, 0.2);
  return (
    <section className="l-uses">
      <div className="l-uses__inner" ref={ref}>
        <p className="l-uses__quote" aria-hidden="true">
          “just between us.”
        </p>
        <div className="l-uses__grid">
          <div>
            <h2 className="h-lg">for the conversations that don't need a transcript.</h2>
            <p>not every chat has to live forever in somebody's cloud.</p>
            <p>not everyone you talk to needs to end up in your contacts.</p>
          </div>
          <ul className={`l-uses__list${seen ? " is-in" : ""}`}>
            {USES.map(([t, ttl], i) => (
              <li key={t} style={{ ["--i" as string]: i }}>
                <span>{t}</span>
                <span className="mono">{ttl}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mono l-uses__foot">if it matters, write it down. melty won't.</p>
      </div>
    </section>
  );
}
