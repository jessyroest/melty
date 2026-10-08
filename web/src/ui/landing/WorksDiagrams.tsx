import { type RefObject, useEffect, useState } from "react";
import { Mascot } from "../Mascot";
import { useNoise, useReducedMotion } from "./hooks";

// ---- tiny animated diagrams for "how the ice works" --------------------------------
// all decorative (aria-hidden): the card text carries the meaning. css animations only
// run while the card is on screen (.is-live); js loops stop when `live` is false.

/** true while the element is on screen and the tab is visible */
export function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [onScreen, setOnScreen] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOnScreen(!!e?.isIntersecting), { rootMargin: "60px" });
    io.observe(el);
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ref]);
  return onScreen && visible;
}

function KeyIcon() {
  return (
    <svg className="wd-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="7.5" cy="12" r="4" />
      <path d="M11.5 12H21M17.5 12v3M20.5 12v2.4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="wd-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  );
}

function ServerIcon() {
  return (
    <svg className="wd-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="7" rx="2" />
      <rect x="4" y="13" width="16" height="7" rx="2" />
      <path d="M8 7.5h.01M8 16.5h.01" />
    </svg>
  );
}

function DeviceIcon() {
  return (
    <svg className="wd-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="11" rx="2" />
      <path d="M2 19.5h20" />
    </svg>
  );
}

/** 01: the url splits at "#": the path travels, the secret stays home */
export function LinkDiagram({ live }: { live: boolean }) {
  const reduced = useReducedMotion();
  const secret = useNoise(43, 3000, reduced || !live);
  return (
    <div className="wd wd-link" aria-hidden="true">
      <div className="wd-url">
        <span className="wd-url__dots">
          <i />
          <i />
          <i />
        </span>
        <span className="wd-url__text mono">
          <span className="wd-url__base">{location.host}/r</span>
          <span className="wd-url__frag">#{secret}</span>
        </span>
      </div>
      <div className="wd-link__flow">
        <div className="wd-node wd-node--home">
          <DeviceIcon />
          <span className="wd-node__name">your device</span>
          <span className="wd-node__note mono">keeps the #</span>
        </div>
        <div className="wd-wire">
          <span className="wd-wire__line" />
          <span className="wd-wall" />
          <span className="wd-wall__label mono"># stays</span>
          <span className="wd-chip wd-chip--frag mono">
            <KeyIcon />#{secret.slice(0, 3)}
          </span>
          <span className="wd-chip wd-chip--base mono">/r</span>
        </div>
        <div className="wd-node wd-node--server">
          <ServerIcon />
          <span className="wd-node__name">server</span>
          <span className="wd-node__note mono">sees /r</span>
        </div>
      </div>
    </div>
  );
}

/** 02: plain text on your device, noise in the relay, plain text again on theirs */
export function RelayDiagram({ live }: { live: boolean }) {
  const reduced = useReducedMotion();
  const sealed = useNoise(18, 110, reduced || !live);
  const arriving = useNoise(13, 110, reduced || !live);
  return (
    <div className="wd wd-relay" aria-hidden="true">
      <div className="wd-relay__row wd-relay__row--you">
        <span className="wd-who mono">you</span>
        <span className="wd-bubble wd-bubble--mine">
          see you at 8?
          <span className="wd-seal">
            <LockIcon />
          </span>
        </span>
      </div>
      <div className="wd-relay__row wd-relay__band">
        <span className="wd-who mono">relay</span>
        <span className="wd-lane">
          <span className="wd-cipher mono">{sealed}</span>
        </span>
      </div>
      <div className="wd-relay__row wd-relay__row--them">
        <span className="wd-bubble wd-bubble--theirs">
          <span className="wd-bubble__noise mono">{arriving}</span>
          <span className="wd-bubble__text">see you at 8?</span>
        </span>
        <span className="wd-who mono">them</span>
      </div>
    </div>
  );
}

/** 03: sealed messages pass through the relay; storage only ever holds the expiry */
export function StoreDiagram() {
  const [exp] = useState(() => Date.now() + 600_000);
  return (
    <div className="wd wd-store" aria-hidden="true">
      <div className="wd-store__lane">
        <span className="wd-store__track" />
        {[0, 1, 2].map((i) => (
          <span key={i} className="wd-env" style={{ ["--i" as string]: i }}>
            <LockIcon />
          </span>
        ))}
        <span className="wd-store__relay mono">relay</span>
      </div>
      <span className="wd-store__pipe mono">writes</span>
      <div className="wd-store__db">
        <span className="wd-store__label mono">server storage</span>
        <code className="wd-store__json mono">
          {"{ "}
          <span className="wd-accent">"expiresAt"</span>: {exp}
          {" }"}
          <span className="wd-caret" />
        </code>
        <span className="wd-store__zero mono">messages kept: 0</span>
      </div>
    </div>
  );
}

const MELT_MS = 9000;
const HOLD_MS = 2000;
const STEP_MS = 100;

function mmss(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** 04: a ten-minute room, sped up: the bar drains and the cube melts with it */
export function DeadlineDiagram({ live }: { live: boolean }) {
  const reduced = useReducedMotion();
  const [t, setT] = useState(0);
  useEffect(() => {
    if (reduced || !live) return;
    const id = setInterval(
      () => setT((p) => (p + STEP_MS / MELT_MS > 1 + HOLD_MS / MELT_MS ? 0 : p + STEP_MS / MELT_MS)),
      STEP_MS,
    );
    return () => clearInterval(id);
  }, [reduced, live]);

  const left = reduced ? 0.38 : Math.max(0, 1 - t);
  const gone = left <= 0;
  const restarting = !reduced && t < 1.5 * (STEP_MS / MELT_MS);
  return (
    <div className={`wd wd-clock${gone ? " is-gone" : ""}`} aria-hidden="true">
      <div className="wd-clock__cube">
        <Mascot left={left} size={104} mood={left < 0.2 ? "surprised" : "happy"} />
      </div>
      <div className="wd-clock__meta">
        <div className="wd-clock__top mono">
          <span>room · 10 min</span>
          <span className="wd-clock__time">{mmss(Math.ceil(left * 600))}</span>
        </div>
        <span className="wd-clock__bar">
          <span
            className={restarting ? "is-reset" : undefined}
            style={{ transform: `scaleX(${left})` }}
          />
        </span>
        <div className="wd-clock__status mono">
          <span className={`wd-pill${gone ? "" : " is-on"}`}>key in memory</span>
          <span className={`wd-pill wd-pill--gone${gone ? " is-on" : ""}`}>wiped · key dropped</span>
        </div>
      </div>
    </div>
  );
}
