import { TTL_OPTIONS, type Ttl } from "@relay/protocol";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { createRoom, MELTED, setNotice } from "../state/session";
import { Frost, frostBurst } from "./landing/Frost";
import { Crack, HeroWords, Snowflake, TtlCube } from "./landing/HeroBits";
import { MeltCurtain } from "./landing/HeroCurtain";
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
      className={`panel start${busy ? " is-busy" : ""}`}
      aria-busy={busy}
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
              <span>
                <TtlCube ttl={t} />
                {TTL_LABELS[t]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <button className="btn btn--primary btn--big start__go" type="submit" disabled={busy}>
        <span className="start__shine" aria-hidden="true" />
        <Crack />
        <span className="start__label">
          {busy && <Snowflake />}
          {busy ? "freezing…" : "open a room"}
        </span>
      </button>
    </form>
  );
}

/** the entrance plays once per page load, not every time you come back to "/" */
let introPlayed = false;
const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const delay = (ms: number) => ({ ["--d" as string]: `${ms}ms` }) as CSSProperties;

export function Home({ notice, onJoin }: { notice: string | null; onJoin: () => void }) {
  const melted = notice === MELTED;
  const [intro] = useState(() => !introPlayed && !melted);
  const hero = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  // when the cube lands, kick up a little frost where it hits
  useEffect(() => {
    introPlayed = true;
    if (!intro || reduceMotion()) return;
    const t = setTimeout(() => {
      const r = stage.current?.getBoundingClientRect();
      if (r && hero.current) frostBurst(hero.current, r.left + r.width / 2, r.top + r.height * 0.86, 18);
    }, 650);
    return () => clearTimeout(t);
  }, [intro]);

  return (
    <div className="landing">
      {melted && <MeltCurtain />}
      <section ref={hero} className={`l-hero${intro ? " is-intro" : ""}`}>
        <Frost bursts />
        <div className="l-hero__art">
          <div ref={stage} className="l-hero__stage">
            <span className="l-hero__shadow" aria-hidden="true" />
            <span className="l-hero__ring" aria-hidden="true" />
            <span className="l-hero__drop">
              {melted ? <Mascot left={0} size={360} className="l-hero__mascot" /> : <LiveMascot pokeable size={360} className="l-hero__mascot" />}
            </span>
          </div>
          {!melted && (
            <p className="l-hero__psst mono" aria-hidden="true">
              psst. poke it.
            </p>
          )}
        </div>
        <div className="l-hero__text">
          <p className="eyebrow mono l-hero__in" style={delay(0)}>
            temporary rooms · end-to-end encrypted
          </p>
          <h1 className="h-display l-hero__title">
            <HeroWords text="say it." />
            <br />
            <span className="accent">
              <HeroWords text="then let it melt." from={2} />
            </span>
          </h1>
          <p className="lead l-hero__in" style={delay(460)}>
            a chat room with a countdown. no account, no history. share a link, talk, and when the timer hits zero it's
            just water.
          </p>

          {notice && (
            <p className={`notice${melted ? " notice--melted" : ""}`} role="status">
              {melted ? "it's water now. nothing was kept." : notice}
            </p>
          )}

          <StartPanel />
          <p className="l-hero__join l-hero__in" style={delay(780)}>
            got a link?{" "}
            <button type="button" className="linklike" onClick={onJoin}>
              join a room
            </button>
          </p>
          <ul className="chips mono l-hero__in" style={delay(860)}>
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
