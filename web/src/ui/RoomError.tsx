import { type ReactNode, useEffect, useRef } from "react";
import { MELTED_BY_CREATOR, NOTICES, type RoomErrorKind } from "../state/session";
import { MeltCurtain } from "./landing/HeroCurtain";
import { type Mood, Mascot } from "./Mascot";
import { LockIcon } from "./RoomIcons";

type Action = "retry" | "new" | "join" | "home";

type Screen = {
  label: string;
  title: string;
  /** used when the session didn't leave a more specific sentence */
  lead: string;
  detail: string;
  /** the cube: how much is left of it, and its face */
  left: number;
  mood: Mood;
  crack?: boolean;
  badge?: "lock" | "full" | "unknown" | "offline";
  /** warm tone for "not now" screens, ice tone for "it's gone" screens */
  tone: "ice" | "warm";
  actions: [Action, ...Action[]];
};

const SCREENS: Record<RoomErrorKind, Screen> = {
  not_found: {
    label: "room · not found",
    title: "no room here",
    lead: NOTICES.not_found,
    detail: "check that the whole link came through, or open a fresh room.",
    left: 1,
    mood: "surprised",
    badge: "unknown",
    tone: "ice",
    actions: ["new", "join"],
  },
  expired: {
    label: "room · melted",
    title: "all melted",
    lead: NOTICES.timerRanOut,
    detail: "it's water now. nothing was kept.",
    left: 0,
    mood: "happy",
    tone: "ice",
    actions: ["new", "home"],
  },
  melted: {
    label: "room · melted",
    title: "melted early",
    lead: MELTED_BY_CREATOR,
    detail: "it's water now. nothing was kept.",
    left: 0,
    mood: "happy",
    tone: "ice",
    actions: ["new", "home"],
  },
  full: {
    label: "room · full",
    title: "it's packed in there",
    lead: NOTICES.full,
    detail: "a spot opens when someone leaves. open the link again in a bit.",
    left: 1,
    mood: "wide",
    badge: "full",
    tone: "warm",
    actions: ["new", "join"],
  },
  locked: {
    label: "room · locked",
    title: "the door is closed",
    lead: NOTICES.locked,
    detail: "once they do, open the link again.",
    left: 1,
    mood: "surprised",
    badge: "lock",
    tone: "warm",
    actions: ["new", "join"],
  },
  limit: {
    label: "slow down",
    title: "that's a lot of rooms",
    lead: NOTICES.limit,
    detail: "the relay caps how many new rooms one network can open.",
    left: 1,
    mood: "sleepy",
    tone: "warm",
    actions: ["home", "join"],
  },
  slow: {
    label: "slow down",
    title: "easy there",
    lead: NOTICES.slow,
    detail: "wait a minute, then open the link again.",
    left: 1,
    mood: "sleepy",
    tone: "warm",
    actions: ["home", "join"],
  },
  unreachable: {
    label: "relay · unreachable",
    title: "can't reach the relay",
    lead: "couldn't connect. you may be offline, or the relay may be down.",
    detail: "when your connection comes back, this tab tries again by itself.",
    left: 1,
    mood: "dizzy",
    crack: true,
    badge: "offline",
    tone: "warm",
    actions: ["retry", "new"],
  },
  lost: {
    label: "connection · lost",
    title: "lost the connection",
    lead: NOTICES.lost,
    detail: "if the room hasn't melted yet, open the original link again to rejoin.",
    left: 0.7,
    mood: "sleepy",
    badge: "offline",
    tone: "warm",
    actions: ["join", "new"],
  },
};

const LABELS: Record<Action, string> = {
  retry: "try again",
  new: "open a new room",
  join: "join with a link",
  home: "back to start",
};

type Props = {
  kind: RoomErrorKind;
  /** the session's own sentence for why it ended, if any */
  notice: string | null;
  onRetry: () => void;
  onNewRoom: () => void;
  onJoin: () => void;
  onHome: () => void;
};

/** A calm, dedicated screen for every way a room can end badly or fail to start. */
export function RoomError({ kind, notice, onRetry, onNewRoom, onJoin, onHome }: Props) {
  const s = SCREENS[kind];
  const heading = useRef<HTMLHeadingElement>(null);
  const melt = kind === "expired" || kind === "melted";
  const keyKept = kind === "unreachable";

  // land screen readers and keyboards on the news, not on the old page
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    scrollTo(0, 0);
  }, [kind]);

  const run: Record<Action, () => void> = { retry: onRetry, new: onNewRoom, join: onJoin, home: onHome };

  return (
    <section className={`rerr rerr--${kind} rerr--${s.tone}`} aria-labelledby="rerr-title">
      {melt && <MeltCurtain />}
      <div className="rerr__card panel">
        <div className="rerr__art" aria-hidden="true">
          <span className="rerr__halo" />
          <Mascot left={s.left} mood={s.mood} crack={s.crack} size={200} className="rerr__mascot" />
          {s.badge && <Badge kind={s.badge} />}
        </div>

        <div className="rerr__text">
          <span className="rerr__label mono">{s.label}</span>
          <h1 id="rerr-title" className="rerr__title" ref={heading} tabIndex={-1}>
            {s.title}
          </h1>
          <p className="rerr__lead">{notice ?? s.lead}</p>
          <p className="rerr__detail">{s.detail}</p>
          <p className={`rerr__key mono${keyKept ? " is-kept" : ""}`}>
            <KeyIcon />
            <span>
              {keyKept
                ? "the room key is still only in this tab's memory. close the tab or open a new room and it's wiped."
                : "the room key is gone from this tab."}
            </span>
          </p>
          <div className="rerr__actions">
            {s.actions.map((a, i) => (
              <button
                key={a}
                type="button"
                className={`btn ${i === 0 ? "btn--primary" : "btn--ghost"} rerr__btn`}
                onClick={run[a]}
              >
                {a === "retry" && <RetryIcon />}
                {LABELS[a]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Badge({ kind }: { kind: NonNullable<Screen["badge"]> }) {
  let body: ReactNode;
  switch (kind) {
    case "lock":
      body = <LockIcon />;
      break;
    case "full":
      body = <span className="mono">8/8</span>;
      break;
    case "unknown":
      body = <span>?</span>;
      break;
    case "offline":
      body = <OfflineIcon />;
      break;
  }
  return <span className={`rerr__badge rerr__badge--${kind}`}>{body}</span>;
}

function Svg({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const KeyIcon = () => (
  <Svg className="rerr__keyicon">
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l8-8M16 7l2.5 2.5M14 9l2 2" />
  </Svg>
);

const OfflineIcon = () => (
  <Svg>
    <path d="M2.5 9a14 14 0 0 1 4.2-2.6M10.5 5.6A14 14 0 0 1 21.5 9M5.5 12.5a9 9 0 0 1 3.4-2M14 10.3a9 9 0 0 1 4.5 2.2M9 16a4.5 4.5 0 0 1 6 0" />
    <path d="M3 3l18 18" />
    <circle cx="12" cy="19.5" r="0.6" fill="currentColor" />
  </Svg>
);

const RetryIcon = () => (
  <Svg className="rerr__retryicon">
    <path d="M20 11a8 8 0 1 0-2.3 5.7" />
    <path d="M20 4.5V11h-6.5" />
  </Svg>
);
