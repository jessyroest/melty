import { type CSSProperties, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Line } from "../state/session";
import { Mascot } from "./Mascot";
import { Bubble, type BubbleActions } from "./RoomBubble";
import { nickHue, RoomCube } from "./RoomCube";
import { ArrowDownIcon, InviteIcon } from "./RoomIcons";

type Props = {
  lines: Line[];
  isCreator: boolean;
  /** 0..1: how high the meltwater stands */
  water: number;
  fraction: number;
  onInvite: () => void;
  actions: BubbleActions;
};

/** The message pool: a scrolling log floating on slowly rising meltwater. */
export function RoomMessages({ lines, isCreator, water, fraction, onInvite, actions }: Props) {
  return (
    <div className="r-pool panel" style={{ "--water": water.toFixed(4) } as CSSProperties}>
      <Water />
      <MessageList
        lines={lines}
        isCreator={isCreator}
        fraction={lines.length ? 1 : fraction}
        onInvite={onInvite}
        actions={actions}
      />
    </div>
  );
}

// ---- water ------------------------------------------------------------------

// one wave every 300px over 2400px, so sliding by 1200px loops seamlessly
const WAVE = (() => {
  let d = "M0 10";
  for (let x = 0; x < 2400; x += 300) d += ` Q${x + 75} 3 ${x + 150} 10 T${x + 300} 10`;
  return d;
})();
const WAVE_FILL = `${WAVE} V24 H0 Z`;

function Water() {
  return (
    <div className="r-water" aria-hidden="true">
      <svg
        className="r-water__wave r-water__wave--back"
        viewBox="0 0 2400 24"
        preserveAspectRatio="none"
        focusable="false"
      >
        <path d={WAVE_FILL} />
      </svg>
      <svg className="r-water__wave" viewBox="0 0 2400 24" preserveAspectRatio="none" focusable="false">
        <path className="r-water__fill" d={WAVE_FILL} />
        <path className="r-water__line" d={WAVE} />
      </svg>
      <div className="r-water__body">
        <i className="r-water__bubble" />
        <i className="r-water__bubble" />
        <i className="r-water__bubble" />
        <i className="r-water__bubble" />
      </div>
    </div>
  );
}

// ---- messages ---------------------------------------------------------------

type Item =
  { type: "sys"; key: number; line: Line } | { type: "group"; key: number; mine: boolean; nick: string; lines: Line[] };

const GROUP_GAP_MS = 5 * 60_000;

/** consecutive messages from the same person (within a few minutes) share one header */
function group(lines: Line[]): Item[] {
  const out: Item[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (l.kind === "system") {
      out.push({ type: "sys", key: l.id, line: l });
    } else if (
      prev?.type === "group" &&
      prev.mine === l.mine &&
      prev.nick === l.nick &&
      l.ts - prev.lines[prev.lines.length - 1]!.ts < GROUP_GAP_MS
    ) {
      prev.lines.push(l);
    } else {
      out.push({ type: "group", key: l.id, mine: l.mine, nick: l.nick, lines: [l] });
    }
  }
  return out;
}

const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

type ListProps = { lines: Line[]; isCreator: boolean; fraction: number; onInvite: () => void; actions: BubbleActions };

const MessageList = memo(function MessageList({ lines, isCreator, fraction, onInvite, actions }: ListProps) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const items = useMemo(() => group(lines), [lines]);
  const last = lines[lines.length - 1];

  // follow new messages, unless you scrolled up to read; then count them
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !last) return;
    if (stick.current || last.mine) {
      el.scrollTop = el.scrollHeight;
      stick.current = true;
      setUnseen(0);
    } else {
      setUnseen((u) => u + 1);
    }
    // only a new last line counts; a reaction or burn on the same line must not scroll or count as unseen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id]);

  // the keyboard opening (or any resize) shouldn't lose your place at the bottom
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function onScroll() {
    const el = box.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (stick.current && unseen) setUnseen(0);
  }

  function jump() {
    const el = box.current;
    if (!el) return;
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    stick.current = true;
    setUnseen(0);
  }

  return (
    <>
      {/* focusable, so keyboards can scroll the log even when nothing in it is a button */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div ref={box} className="messages" role="log" aria-live="polite" aria-label="messages" tabIndex={0} onScroll={onScroll}>
        {items.length === 0 ? (
          <Empty isCreator={isCreator} fraction={fraction} onInvite={onInvite} />
        ) : (
          items.map((it) =>
            it.type === "sys" ? (
              <SystemLine key={it.key} line={it.line} />
            ) : (
              <Group key={it.key} item={it} actions={actions} />
            ),
          )
        )}
      </div>
      {unseen > 0 && (
        <button className="r-jump" type="button" onClick={jump}>
          <ArrowDownIcon />
          {unseen === 1 ? "1 new message" : `${unseen} new messages`}
        </button>
      )}
    </>
  );
});

function Group({ item, actions }: { item: Extract<Item, { type: "group" }>; actions: BubbleActions }) {
  const { mine, nick, lines } = item;
  const lastLine = lines[lines.length - 1]!;
  return (
    <div
      className={`r-msgs ${mine ? "r-msgs--mine" : "r-msgs--theirs"}`}
      style={mine ? undefined : ({ "--hue": nickHue(nick) } as CSSProperties)}
    >
      {!mine && <RoomCube size={30} className="r-msgs__avatar" />}
      <div className="r-msgs__col">
        {!mine && (
          <bdi className="r-msgs__nick" aria-hidden="true">
            {nick}
          </bdi>
        )}
        {lines.map((l) => (
          <Bubble key={l.id} line={l} nick={nick} mine={mine} actions={actions} />
        ))}
        <time className="r-msgs__time mono" dateTime={new Date(lastLine.ts).toISOString()}>
          {mine ? `you · ${clock(lastLine.ts)}` : clock(lastLine.ts)}
        </time>
      </div>
    </div>
  );
}

/** the nicknames in a notice are someone else's text: isolate them so bidi tricks stay inside */
function sysText(line: Line) {
  const { text: t, nick } = line;
  if (!nick) return t;
  if (t === `${nick} joined` || t === `${nick} left`) {
    return (
      <>
        <bdi>{nick}</bdi>
        {t.slice(nick.length)}
      </>
    );
  }
  if (t === `you're ${nick} now`) {
    return (
      <>
        you're <bdi>{nick}</bdi> now
      </>
    );
  }
  const tail = ` is now ${nick}`;
  if (t.endsWith(tail)) {
    return (
      <>
        <bdi>{t.slice(0, -tail.length)}</bdi> is now <bdi>{nick}</bdi>
      </>
    );
  }
  return <bdi>{t}</bdi>;
}

function SystemLine({ line }: { line: Line }) {
  const t = line.text;
  const kind = !line.nick && t.startsWith("the room is")
    ? "lock"
    : t === `${line.nick} joined`
      ? "join"
      : t === `${line.nick} left`
        ? "leave"
        : "nick";
  return (
    <p className={`r-sys r-sys--${kind}`}>
      <span className="r-sys__glyph" aria-hidden="true">
        {kind === "join" ? "+" : kind === "leave" ? "−" : kind === "lock" ? "🔒" : "✎"}
      </span>
      <span className="r-sys__text">{sysText(line)}</span>
    </p>
  );
}

function Empty({ isCreator, fraction, onInvite }: { isCreator: boolean; fraction: number; onInvite: () => void }) {
  return (
    <div className="r-hush">
      <div className="r-hush__art" aria-hidden="true">
        <span className="r-hush__halo" />
        <Mascot left={fraction} size={112} className="r-hush__mascot" />
        <span className="r-hush__dots">
          <i />
          <i />
          <i />
        </span>
      </div>
      <h2 className="r-hush__title">{isCreator ? "it's quiet. invite someone." : "it's quiet. say hi."}</h2>
      <p className="r-hush__text">
        {isCreator
          ? "people only see what's sent after they arrive."
          : "you won't see anything sent before you joined."}
      </p>
      {isCreator && (
        <button className="btn btn--primary r-hush__cta" type="button" onClick={onInvite}>
          <InviteIcon />
          invite people
        </button>
      )}
      <ul className="r-hush__facts mono">
        <li>end-to-end encrypted</li>
        <li>never stored on the server</li>
        <li>max 8 people</li>
      </ul>
    </div>
  );
}
