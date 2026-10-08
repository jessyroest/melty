import { type ReactNode, useRef, useState } from "react";
import { useInView, useNoise, useReducedMotion } from "./hooks";

// ---- how the ice works: four cards with tiny live illustrations -----------------

function LinkIllo() {
  const reduced = useReducedMotion();
  const secret = useNoise(43, 2600, reduced);
  return (
    <pre className="illo" aria-hidden="true">
      <span className="muted">{location.host}/r</span>
      <span className="accent">#{secret.slice(0, 14)}…</span>
      {"\n"}
      <span className="muted">└─ </span>never leaves your browser
    </pre>
  );
}

function NoiseIllo() {
  const reduced = useReducedMotion();
  const sealed = useNoise(16, 90, reduced);
  return (
    <pre className="illo" aria-hidden="true">
      <span className="muted">you   </span>see you at 8?{"\n"}
      <span className="muted">relay </span>
      <span className="accent">{sealed}</span>
      {"\n"}
      <span className="muted">them  </span>see you at 8?
    </pre>
  );
}

function StoreIllo() {
  const [exp] = useState(() => Date.now() + 600_000);
  return (
    <pre className="illo" aria-hidden="true">
      {"{\n  "}
      <span className="accent">"expiresAt"</span>: {exp}
      {"\n}\n"}
      <span className="muted">// that's all of it</span>
      <span className="caret">▍</span>
    </pre>
  );
}

function ClockIllo() {
  return (
    <div className="illo illo--clock" aria-hidden="true">
      <span className="mono muted">room k3f9</span>
      <span className="illo__bar">
        <span />
      </span>
    </div>
  );
}

function WorkCard({ illo, title, children }: { illo: ReactNode; title: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const seen = useInView(ref, 0.3);
  return (
    <article ref={ref} className={`l-card reveal${seen ? " is-in" : ""}`}>
      {illo}
      <h3>{title}</h3>
      <p>{children}</p>
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
        <p className="lead">four ideas, no magic. the details are on the how-it-works page.</p>
      </div>
      <div className="l-works__grid">
        <WorkCard illo={<LinkIllo />} title="the link is the key">
          your browser makes a random 32-byte secret and puts it after the # in the link. browsers never send that
          part to a server.
        </WorkCard>
        <WorkCard illo={<NoiseIllo />} title="the relay sees noise">
          messages are sealed with AES-256-GCM on your device. the relay passes sealed envelopes along and can't open
          them.
        </WorkCard>
        <WorkCard illo={<StoreIllo />} title="nothing is kept">
          no message is ever written to the server's storage. the only thing it remembers is when your room melts.
        </WorkCard>
        <WorkCard illo={<ClockIllo />} title="a real deadline">
          10 minutes, an hour or a day. when time's up the room is wiped for everyone and every browser drops the key.
        </WorkCard>
      </div>
    </section>
  );
}
