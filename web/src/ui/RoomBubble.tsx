import { type CSSProperties, useState } from "react";
import { REACTIONS, type Reaction } from "../crypto/message";
import { BURN_MS, type Line } from "../state/session";
import { FlameIcon, SmileIcon } from "./RoomIcons";
import { useNow } from "./time";

export type BubbleActions = {
  me: string;
  reveal: (lineId: number) => void;
  react: (lineId: number, emoji: Reaction) => void;
};

/**
 * One chat bubble. Burn-after-read messages arrive frozen and only show their
 * text when you open them; then they count down and drip away.
 */
export function Bubble({ line, nick, mine, actions }: { line: Line; nick: string; mine: boolean; actions: BubbleActions }) {
  const [picking, setPicking] = useState(false);
  const frozen = line.burn && !line.revealed;
  const cls = `r-bubble${line.burn ? " r-bubble--burn" : ""}${frozen ? " r-bubble--frozen" : ""}${line.melting ? " is-melting" : ""}`;

  return (
    <>
      <p className={cls}>
        {frozen ? (
          <button className="r-bubble__thaw" type="button" onClick={() => actions.reveal(line.id)}>
            <FlameIcon />
            <span>
              <b>burn after reading.</b> tap to open · it melts {BURN_MS / 1000}s later
            </span>
            <span className="sr-only">, from {nick}</span>
          </button>
        ) : (
          <>
            <span className="sr-only">{mine ? "you: " : `${nick}: `}</span>
            {line.text}
            {line.burn && line.burnAt && <BurnTimer at={line.burnAt} />}
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
        <span className="r-picker" role="group" aria-label="pick a reaction">
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
            aria-label={`${e} from ${who.join(", ")}. ${mineToo ? "remove yours" : "add yours"}`}
            title={who.join(", ")}
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
