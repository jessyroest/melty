import { useEffect, useRef } from "react";
import type { Knock, SafetyCheck, View } from "../state/session";
import { Mascot } from "./Mascot";

type DoorApi = {
  letIn(hs: string): void;
  turnAway(hs: string): void;
  confirmCheck(hs: string, match: boolean): void;
};

/** Waiting outside: for the key (came with the link) or to be let in (came with the words). */
export function Doorstep({ view, onCancel }: { view: View; onCancel: () => void }) {
  const knocking = view.status === "knocking";
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [knocking]);
  return (
    <section className="r-door-wait panel" aria-labelledby="door-wait-title">
      <div className="r-hush__art" aria-hidden="true">
        <span className="r-hush__halo" />
        <Mascot left={1} size={110} mood={knocking ? "wide" : "happy"} className="r-hush__mascot" />
        <span className="r-hush__dots">
          <i />
          <i />
          <i />
        </span>
      </div>
      <span className="r-door-wait__label mono">{knocking ? "door · knocking" : "door · key exchange"}</span>
      <h1 id="door-wait-title" ref={heading} tabIndex={-1}>
        {knocking ? "knocking…" : "getting the key…"}
      </h1>
      {knocking ? (
        <p>
          someone inside has to let you in. when they do, you'll both see 6 safety words. compare them out loud, by
          phone or in person.
        </p>
      ) : (
        <p>
          the link doesn't hold the room key. someone inside hands it over through a post-quantum key exchange, which
          takes a moment.
        </p>
      )}
      {knocking && view.words && (
        <p className="r-door-wait__words mono" aria-label={`you knocked with: ${view.words.join(" ")}`}>
          {view.words.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </p>
      )}
      <button className="btn btn--ghost" type="button" onClick={onCancel}>
        {knocking ? "stop knocking" : "cancel"}
      </button>
    </section>
  );
}

/** Knocks and safety words, above the messages. Renders nothing when there's nothing to say. */
export function DoorNotices({ knocks, checks, api }: { knocks: Knock[]; checks: SafetyCheck[]; api: DoorApi }) {
  const open = checks.filter((c) => c.state === "open");
  if (knocks.length === 0 && open.length === 0) return null;
  return (
    <div className="r-door" role="region" aria-label="door">
      {knocks.map((k) => (
        <KnockCard key={k.hs} knock={k} api={api} />
      ))}
      {open.map((c) => (
        <CheckCard key={c.hs} check={c} api={api} />
      ))}
    </div>
  );
}

function KnockCard({ knock, api }: { knock: Knock; api: DoorApi }) {
  return (
    <div className="r-door__card r-door__card--knock" role="alert">
      <div className="r-door__text">
        <strong>someone is knocking with the 4 words.</strong>
        <span>let them in only if you're expecting someone. you'll get 6 safety words to compare with them.</span>
      </div>
      <div className="r-door__actions">
        <button className="btn btn--primary btn--small" type="button" onClick={() => api.letIn(knock.hs)}>
          let in
        </button>
        <button className="btn btn--ghost btn--small" type="button" onClick={() => api.turnAway(knock.hs)}>
          not now
        </button>
      </div>
    </div>
  );
}

function CheckCard({ check, api }: { check: SafetyCheck; api: DoorApi }) {
  const who =
    check.role === "joiner"
      ? check.peer
        ? `with ${check.peer}, who let you in`
        : "with whoever let you in"
      : check.peer
        ? `with ${check.peer}, who you just let in`
        : "with the person you just let in";
  return (
    <div className="r-door__card r-door__card--check">
      <div className="r-door__text">
        <strong>
          compare these words <bdi>{who}</bdi>.
        </strong>
        <ol className="r-door__words mono" aria-label="safety words">
          {check.words.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ol>
        <span>
          say them out loud, on a call or in person, not in this chat. same words: nobody sat in the middle of the key
          exchange.
        </span>
      </div>
      <div className="r-door__actions">
        <button className="btn btn--primary btn--small" type="button" onClick={() => api.confirmCheck(check.hs, true)}>
          same words
        </button>
        <button className="btn btn--ghost btn--small r-door__bad" type="button" onClick={() => api.confirmCheck(check.hs, false)}>
          different
        </button>
      </div>
    </div>
  );
}
