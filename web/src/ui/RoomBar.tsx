import { MAX_PARTICIPANTS } from "@relay/protocol";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { Status, View } from "../state/session";
import { LiveMascot } from "./LiveMascot";
import { RoomCube } from "./RoomCube";
import { DropIcon, EyeOffIcon, InviteIcon, LeaveIcon, LockIcon, UnlockIcon } from "./RoomIcons";
import { formatLeft, spokenLeft } from "./time";

/** below this fraction of the lifetime the room gets a little nervous */
export const URGENT = 0.1;

export function timeLeft(view: View, now: number): { leftMs: number; fraction: number } {
  if (view.expiresAt === null || view.ttlMs === null) return { leftMs: 0, fraction: 1 };
  const leftMs = Math.min(view.ttlMs, view.expiresAt - (now + view.offset));
  return { leftMs, fraction: Math.max(0, Math.min(1, leftMs / view.ttlMs)) };
}

type Props = {
  view: View;
  leftMs: number;
  fraction: number;
  onShare: () => void;
  onLeave: () => void;
  onLock: (on: boolean) => void;
  onDeter: (on: boolean) => void;
  onMelt: () => void;
};

export function RoomBar({ view, leftMs, fraction, onShare, onLeave, onLock, onDeter, onMelt }: Props) {
  const known = view.expiresAt !== null && view.ttlMs !== null;
  const urgent = known && fraction <= URGENT;

  return (
    <header className={`roombar panel${urgent ? " is-urgent" : ""}${view.isCreator ? " roombar--owner" : ""}`}>
      <MeltRing fraction={fraction} bump={view.lines.length} urgent={urgent} />

      <div className="roombar__clock">
        <span className="roombar__label mono">{!known ? "freezing" : urgent ? "almost gone" : "melts in"}</span>
        <span className="roombar__time" aria-hidden="true">
          <Digits text={known ? formatLeft(leftMs) : "–:––"} />
        </span>
        <span className="sr-only" aria-live="polite">
          {known ? spokenLeft(leftMs) : ""}
        </span>
      </div>

      <div className="roombar__meta">
        <Presence n={view.n} />
        <span className="roombar__e2e">
          <LockIcon />
          end-to-end encrypted
        </span>
        <StatusPill status={view.status} />
        {view.locked && (
          <span className="r-locked">
            <LockIcon />
            locked
          </span>
        )}
        {view.deter && (
          <span className="r-deter" title="messages blur until you touch them, and when you look away. it makes casual screenshots harder; it can't stop them.">
            <EyeOffIcon />
            screenshot deterrent
          </span>
        )}
      </div>

      {view.isCreator && (
        <div className="roombar__owner" role="group" aria-label="creator controls">
          <button
              className={`btn btn--ghost btn--small r-lockbtn${view.locked ? " is-on" : ""}`}
              type="button"
              aria-pressed={view.locked}
              aria-label={view.locked ? "unlock the room" : "lock the room: nobody new can join"}
              title={view.locked ? "unlock the room" : "lock the room"}
              onClick={() => onLock(!view.locked)}
              disabled={view.status !== "live"}
            >
              {view.locked ? <LockIcon /> : <UnlockIcon />}
              <span className="r-lockbtn__text">{view.locked ? "locked" : "lock"}</span>
            </button>
          <button
            className={`btn btn--ghost btn--small r-deterbtn${view.deter ? " is-on" : ""}`}
            type="button"
            aria-pressed={view.deter}
            aria-label={
              view.deter
                ? "turn screenshot deterrents off"
                : "turn on screenshot deterrents for everyone: messages blur until touched, plus a watermark. best effort"
            }
            title={view.deter ? "screenshot deterrents: on" : "screenshot deterrents (best effort)"}
            onClick={() => onDeter(!view.deter)}
            disabled={view.status !== "live"}
          >
            <EyeOffIcon />
            <span className="r-deterbtn__text">{view.deter ? "deterring" : "deter"}</span>
          </button>
          <HoldToMelt onMelt={onMelt} disabled={view.status !== "live"} />
        </div>
      )}

      <div className="roombar__actions">
        <button className="btn btn--primary btn--small roombar__invite" type="button" onClick={onShare}>
          <InviteIcon />
          <span>invite</span>
        </button>
        <LeaveButton onLeave={onLeave} />
      </div>
    </header>
  );
}

/** fixed-width digits, so the countdown doesn't wobble as it ticks */
function Digits({ text }: { text: string }) {
  return (
    <>
      {[...text].map((c, i) =>
        /[0-9–]/.test(c) ? (
          <span key={i} className="r-digit">
            {c}
          </span>
        ) : (
          <span key={i} className={c === ":" ? "r-colon" : "r-unit"}>
            {c}
          </span>
        ),
      )}
    </>
  );
}

/** the live mascot inside a ring that drains as the room's time runs out */
function MeltRing({ fraction, bump, urgent }: { fraction: number; bump: unknown; urgent: boolean }) {
  const a = fraction * 2 * Math.PI - Math.PI / 2;
  return (
    <div className="r-ring">
      <svg className="r-ring__svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle className="r-ring__track" cx="50" cy="50" r="46" />
        <circle
          className="r-ring__melt"
          cx="50"
          cy="50"
          r="46"
          pathLength={100}
          strokeDasharray="100 100"
          strokeDashoffset={100 * (1 - fraction)}
          transform="rotate(-90 50 50)"
        />
        {fraction > 0.004 && (
          <circle className="r-ring__tip" cx={50 + 46 * Math.cos(a)} cy={50 + 46 * Math.sin(a)} r="3.4" />
        )}
      </svg>
      <LiveMascot left={fraction} size={64} className="r-ring__mascot" bump={bump} />
      {urgent && (
        <span className="r-ring__sweat" aria-hidden="true">
          <i />
          <i />
        </span>
      )}
    </div>
  );
}

const HUES = [186, 265, 330, 38, 140, 212, 8, 292];

function Presence({ n }: { n: number }) {
  return (
    <span className="r-presence">
      <span className="r-presence__cubes" aria-hidden="true">
        {HUES.map((hue, i) => (
          <span
            key={i}
            className={`r-presence__slot${i < n ? " is-here" : ""}`}
            style={{ "--hue": hue } as CSSProperties}
          >
            <RoomCube size={18} />
          </span>
        ))}
      </span>
      <span>
        <b>{n}</b> of {MAX_PARTICIPANTS} here
      </span>
    </span>
  );
}

function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`r-status r-status--${status}`} aria-live="polite">
      <span className="r-status__dot" aria-hidden="true" />
      {status === "live"
        ? "live"
        : status === "connecting"
          ? "connecting…"
          : status === "reconnecting"
            ? "reconnecting…"
            : status === "knocking"
              ? "knocking…"
              : "getting the key…"}
    </span>
  );
}

const HOLD_MS = 1500;

/** melting the room for everyone needs a deliberate press-and-hold (mouse, touch or keyboard) */
function HoldToMelt({ onMelt, disabled }: { onMelt: () => void; disabled: boolean }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const start = () => {
    if (disabled || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setHolding(false);
      onMelt();
    }, HOLD_MS);
  };
  const stop = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  };
  useEffect(() => stop, []);

  return (
    <button
      className={`btn btn--ghost btn--small r-meltbtn${holding ? " is-holding" : ""}`}
      type="button"
      disabled={disabled}
      aria-label="melt the room now for everyone. press and hold"
      title="hold to melt the room for everyone"
      style={{ "--hold": `${HOLD_MS}ms` } as CSSProperties}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") stop();
      }}
      onBlur={stop}
    >
      <span className="r-meltbtn__fill" aria-hidden="true" />
      <DropIcon />
      <span className="r-meltbtn__text">{holding ? "keep holding…" : "melt now"}</span>
    </button>
  );
}

function LeaveButton({ onLeave }: { onLeave: () => void }) {
  return (
    <button
      className="btn btn--ghost btn--small roombar__leave"
      type="button"
      onClick={onLeave}
      aria-label="leave room"
    >
      <LeaveIcon />
      <span className="roombar__leave-text">leave</span>
    </button>
  );
}
