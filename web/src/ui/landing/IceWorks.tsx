import { type PointerEvent, type ReactNode, useRef } from "react";
import { useInView, useReducedMotion } from "./hooks";
import { DeadlineDiagram, LinkDiagram, RelayDiagram, StoreDiagram, useOnScreen } from "./WorksDiagrams";

// ---- how the ice works: four cards, each with a small live diagram ------------------

type CardProps = {
  n: number;
  tag: string;
  title: string;
  wide?: boolean;
  illo: (live: boolean) => ReactNode;
  children: ReactNode;
};

function WorkCard({ n, tag, title, wide, illo, children }: CardProps) {
  const ref = useRef<HTMLElement>(null);
  const seen = useInView(ref, 0.2);
  const live = useOnScreen(ref);
  const reduced = useReducedMotion();

  // tilt toward the pointer and let a frost sheen follow it (mouse only)
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    if (reduced) return;
    el.style.setProperty("--rx", `${((0.5 - y) * 5).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${((x - 0.5) * (wide ? 4 : 6)).toFixed(2)}deg`);
  };
  const onLeave = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.style.setProperty("--rx", "0deg");
    e.currentTarget.style.setProperty("--ry", "0deg");
  };

  return (
    <article
      ref={ref}
      className={`wk reveal${wide ? " wk--wide" : ""}${seen ? " is-in" : ""}${live ? " is-live" : ""}`}
    >
      <div className="wk__card" onPointerMove={onMove} onPointerLeave={onLeave}>
        <div className="wk__stage">{illo(live)}</div>
        <div className="wk__text">
          <p className="wk__tag mono">
            <span>0{n}</span> {tag}
          </p>
          <h3>{title}</h3>
          <p>{children}</p>
        </div>
      </div>
    </article>
  );
}

export function IceWorks() {
  return (
    <section className="l-section l-works" id="how-ice-works">
      <div className="l-works__head">
        <h2 className="h-xl">
          how the ice
          <br />
          works.
        </h2>
        <div>
          <p className="lead">four ideas, no magic. the details are on the how-it-works page.</p>
          <p className="l-works__kicker mono">key · noise · no messages stored · deadline</p>
        </div>
      </div>
      <div className="l-works__grid">
        <WorkCard n={1} tag="the key" title="the link is the key" wide illo={(live) => <LinkDiagram live={live} />}>
          your browser makes a random 32-byte secret and puts it after the # in the link. browsers never send that
          part to a server.
        </WorkCard>
        <WorkCard n={2} tag="the relay" title="the relay sees noise" illo={(live) => <RelayDiagram live={live} />}>
          messages are sealed with AES-256-GCM on your device. the relay passes sealed envelopes along and can't open
          them.
        </WorkCard>
        <WorkCard n={3} tag="the storage" title="no messages stored" illo={() => <StoreDiagram />}>
          no message is ever written to the server's storage. the only thing it remembers is when your room melts.
        </WorkCard>
        <WorkCard n={4} tag="the timer" title="a real deadline" wide illo={(live) => <DeadlineDiagram live={live} />}>
          10 minutes, an hour or a day. when time's up the room is wiped for everyone and every browser drops the key.
        </WorkCard>
      </div>
    </section>
  );
}
