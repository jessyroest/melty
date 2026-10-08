import { MAX_PARTICIPANTS } from "@relay/protocol";
import type { CSSProperties } from "react";
import type { Status, View } from "../state/session";
import { LiveMascot } from "./LiveMascot";
import { RoomCube } from "./RoomCube";
import { InviteIcon, LeaveIcon, LockIcon } from "./RoomIcons";
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
};

export function RoomBar({ view, leftMs, fraction, onShare, onLeave }: Props) {
  const known = view.expiresAt !== null && view.ttlMs !== null;
  const urgent = known && fraction <= URGENT;

  return (
    <header className={`roombar panel${urgent ? " is-urgent" : ""}`}>
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
      </div>

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
      {status === "live" ? "live" : status === "connecting" ? "connecting…" : "reconnecting…"}
    </span>
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
