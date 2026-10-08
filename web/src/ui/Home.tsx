import { TTL_OPTIONS, type Ttl } from "@relay/protocol";
import { useEffect, useState } from "react";
import { createRoom, MELTED, setNotice } from "../state/session";
import { Frost } from "./landing/Frost";
import { FinalCta, Footer, Honest, IceWorks, MeltScroll, NeverAsk, UseCases } from "./landing/Sections";
import { LiveMascot } from "./LiveMascot";
import { Mascot } from "./Mascot";
import { TTL_LABELS } from "./time";

export function focusStart(): void {
  const el = document.getElementById("start");
  el?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  el?.querySelector<HTMLInputElement>("input:checked")?.focus({ preventScroll: true });
}

function StartPanel() {
  const [ttl, setTtl] = useState<Ttl>(3600);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setNotice(null);
    await createRoom(ttl);
  }

  return (
    <form
      id="start"
      className="panel start"
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <fieldset className="ttl">
        <legend>melts in</legend>
        <div className="ttl__options">
          {TTL_OPTIONS.map((t) => (
            <label key={t} className="ttl__option">
              <input type="radio" name="ttl" value={t} checked={ttl === t} onChange={() => setTtl(t)} />
              <span>{TTL_LABELS[t]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <button className="btn btn--primary btn--big" type="submit" disabled={busy}>
        {busy ? "freezing…" : "open a room"}
      </button>
    </form>
  );
}

/** the screen drips away when you arrive here because your room melted */
function MeltCurtain() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setOn(false), 2600);
    return () => clearTimeout(t);
  }, []);
  if (!on) return null;
  return (
    <div className="curtain" aria-hidden="true">
      {Array.from({ length: 14 }, (_, i) => (
        <span key={i} style={{ ["--i" as string]: i, ["--r" as string]: ((i * 37) % 11) / 10 }} />
      ))}
    </div>
  );
}

export function Home({ notice, onJoin }: { notice: string | null; onJoin: () => void }) {
  const melted = notice === MELTED;

  return (
    <div className="landing">
      {melted && <MeltCurtain />}
      <section className="l-hero">
        <Frost />
        <div className="l-hero__art">
          {melted ? <Mascot left={0} size={360} className="l-hero__mascot" /> : <LiveMascot pokeable size={360} className="l-hero__mascot" />}
          {!melted && (
            <p className="l-hero__psst mono" aria-hidden="true">
              psst. poke it.
            </p>
          )}
        </div>
        <div className="l-hero__text">
          <p className="eyebrow mono">temporary rooms · end-to-end encrypted</p>
          <h1 className="h-display">
            say it.
            <br />
            <span className="accent">then let it melt.</span>
          </h1>
          <p className="lead">
            a chat room with a countdown. no account, no history. share a link, talk, and when the timer hits zero it's
            just water.
          </p>

          {notice && (
            <p className={`notice${melted ? " notice--melted" : ""}`} role="status">
              {melted ? "it's water now. nothing was kept." : notice}
            </p>
          )}

          <StartPanel />
          <p className="l-hero__join">
            got a link?{" "}
            <button type="button" className="linklike" onClick={onJoin}>
              join a room
            </button>
          </p>
          <ul className="chips mono">
            <li>end-to-end encrypted</li>
            <li>no account</li>
            <li>messages never stored</li>
          </ul>
        </div>
      </section>

      <NeverAsk />
      <MeltScroll />
      <IceWorks />
      <UseCases />
      <Honest />
      <FinalCta onStart={focusStart} onJoin={onJoin} />
      <Footer />
    </div>
  );
}
