import { type CSSProperties, type MouseEvent, useEffect, useRef, useState } from "react";
import { REACTIONS, type Reaction } from "../crypto/message";
import { BURN_MS, type Line } from "../state/session";
import { FlameIcon, SmileIcon } from "./RoomIcons";
import { useNow } from "./time";

export type BubbleActions = {
  me: string;
  reveal: (lineId: number) => void;
  react: (lineId: number, emoji: Reaction) => void;
};

/** wrap a nickname in first-strong isolates, for attributes where <bdi> can't go */
const FSI = String.fromCharCode(0x2068);
const PDI = String.fromCharCode(0x2069);
export const isolate = (s: string) => `${FSI}${s}${PDI}`;

const touchOnly = () => matchMedia("(hover: none)").matches;

/**
 * One chat bubble. Burn-after-read messages arrive frozen and only show their
 * text when you open them; then they count down and drip away.
 */
export function Bubble({ line, nick, mine, actions }: { line: Line; nick: string; mine: boolean; actions: BubbleActions }) {
  const [picking, setPicking] = useState(false);
  const picker = useRef<HTMLSpanElement>(null);
  const frozen = line.burn && !line.revealed;
  const canReact = !!line.msgId && !line.melting && !frozen;
  const cls = `r-bubble${line.burn ? " r-bubble--burn" : ""}${frozen ? " r-bubble--frozen" : ""}${line.melting ? " is-melting" : ""}${canReact ? " can-react" : ""}${line.undelivered ? " r-bubble--undelivered" : ""}`;

  // phones can't hover to find the react button: a tap anywhere on the bubble opens the picker.
  // (a long press still selects text, since that isn't a click)
  const onTap = (e: MouseEvent<HTMLParagraphElement>) => {
    if (!canReact || !touchOnly()) return;
    if ((e.target as Element).closest("button")) return;
    if (getSelection()?.toString()) return;
    setPicking((p) => !p);
  };

  // the picker opens under the bubble; on a short phone screen that can be below the fold
  useEffect(() => {
    const el = picker.current;
    const log = el?.closest<HTMLElement>(".messages");
    if (!picking || !el || !log) return;
    // layout offsets, not getBoundingClientRect: the picker is still mid pop-in (scaled down)
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    const below = el.offsetTop + el.offsetHeight + 12 - log.clientHeight;
    if (log.scrollTop < below) log.scrollTo({ top: below, behavior });
    else if (el.offsetTop - 12 < log.scrollTop) log.scrollTo({ top: el.offsetTop - 12, behavior });
  }, [picking]);

  return (
    <>
      {/* phones: a tap on the bubble opens the reaction picker. keyboards and screen readers use the react button */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions */}
      <p className={cls} onClick={onTap}>
        {frozen ? (
          <button className="r-bubble__thaw" type="button" onClick={() => actions.reveal(line.id)}>
            <FlameIcon />
            <span>
              <b>burn after reading.</b> tap to open · it melts {BURN_MS / 1000}s later
              <small className="r-bubble__caveat">best effort: a screenshot still keeps it</small>
            </span>
            <span className="sr-only">
              , from <bdi>{nick}</bdi>
            </span>
          </button>
        ) : (
          <>
            <span className="sr-only">{mine ? "you: " : <><bdi>{nick}</bdi>: </>}</span>
            <bdi className="r-text">{line.text}</bdi>
            {line.burn && line.burnAt && <BurnTimer at={line.burnAt} />}
            {line.undelivered && <small className="r-bubble__undelivered mono">not delivered</small>}
            {line.msgId && !line.melting && (
              <button
                className={`r-bubble__react${picking ? " is-open" : ""}`}
                type="button"
                aria-label="react to this message"
                aria-expanded={picking}
                onClick={() => setPicking((p) => !p)}
              >
                <SmileIcon />
              </button>
            )}
          </>
        )}
      </p>
      {picking && !frozen && (
        <span ref={picker} className="r-picker" role="group" aria-label="pick a reaction">
          {REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              className="r-picker__btn"
              onClick={() => {
                actions.react(line.id, e);
                setPicking(false);
              }}
              aria-label={`react with ${e}`}
            >
              {e}
            </button>
          ))}
        </span>
      )}
      <Reactions line={line} actions={actions} />
    </>
  );
}

function Reactions({ line, actions }: { line: Line; actions: BubbleActions }) {
  const chips = REACTIONS.map((e) => [e, line.reactions?.[e] ?? []] as const).filter(([, who]) => who.length > 0);
  if (!chips.length || line.melting) return null;
  return (
    <span className="r-reacts">
      {chips.map(([e, who]) => {
        const mineToo = who.includes(actions.me);
        return (
          <button
            key={e}
            type="button"
            className={`r-react${mineToo ? " is-mine" : ""}`}
            aria-pressed={mineToo}
            aria-label={`${e} from ${who.map(isolate).join(", ")}. ${mineToo ? "remove yours" : "add yours"}`}
            title={who.map(isolate).join(", ")}
            onClick={() => actions.react(line.id, e)}
          >
            <span aria-hidden="true">{e}</span>
            <span className="r-react__n mono" aria-hidden="true">
              {who.length}
            </span>
          </button>
        );
      })}
    </span>
  );
}

/** a small countdown and a fuse along the bottom of the bubble */
function BurnTimer({ at }: { at: number }) {
  const now = useNow(250);
  const left = Math.max(0, at - now);
  return (
    <span className="r-burn" style={{ "--burn": `${left}ms`, "--burn-left": left / BURN_MS } as CSSProperties}>
      <span className="r-burn__fuse" aria-hidden="true" />
      <span className="r-burn__label mono" aria-hidden="true">
        <FlameIcon />
        {Math.ceil(left / 1000)}s
      </span>
    </span>
  );
}
