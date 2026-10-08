import { useCallback, useEffect, useRef, useState } from "react";
import { navigate } from "../lib/router";
import type { View } from "../state/session";
import { useStore } from "../state/session";
import { Mascot } from "./Mascot";
import { RoomBar, timeLeft, URGENT } from "./RoomBar";
import { RoomComposer } from "./RoomComposer";
import { RoomMessages } from "./RoomMessages";
import { ShareSheet } from "./ShareSheet";
import { formatLeft, useNow } from "./time";

export function Chat() {
  const { session, view } = useStore();
  if (!session || !view) return <NoRoom />;
  return <Room view={view} session={session} />;
}

function NoRoom() {
  return (
    <div className="r-gone panel">
      <Mascot left={0} size={120} className="r-gone__mascot" />
      <span className="r-gone__label mono">room · not found</span>
      <h1>nothing here</h1>
      <p>
        rooms only live in memory. if you had one open in this tab, it's gone. open the original link again to rejoin.
      </p>
      <button className="btn btn--primary" type="button" onClick={() => navigate("/")}>
        back to start
      </button>
    </div>
  );
}

type SessionApi = NonNullable<ReturnType<typeof useStore>["session"]>;

function Room({ view, session }: { view: View; session: SessionApi }) {
  const [sharing, setSharing] = useState(false);
  const now = useNow(1000);
  const { leftMs, fraction } = timeLeft(view, now);
  const known = view.expiresAt !== null;
  const melt = known ? 1 - fraction : 0;
  const urgent = known && fraction <= URGENT;

  // the countdown in the tab title, so you can see it from another tab
  useEffect(() => {
    if (known) document.title = `${formatLeft(leftMs)} · melty`;
  }, [leftMs, known]);
  useEffect(() => {
    const prev = document.title;
    return () => {
      document.title = prev;
    };
  }, []);

  // the creator gets the invite sheet once, right away
  const shownOnce = useRef(false);
  useEffect(() => {
    if (view.isCreator && view.status === "live" && !shownOnce.current) {
      shownOnce.current = true;
      setSharing(true);
    }
  }, [view.isCreator, view.status]);

  const openShare = useCallback(() => setSharing(true), []);
  const link = sharing ? session.shareLink() : null;

  return (
    <div className={`room${urgent ? " room--urgent" : ""}${view.status === "live" ? "" : " room--offline"}`}>
      <RoomBar
        view={view}
        leftMs={leftMs}
        fraction={fraction}
        onShare={openShare}
        onLeave={() => void session.leave("you left. nothing was kept.")}
      />
      <RoomMessages
        lines={view.lines}
        isCreator={view.isCreator}
        water={melt * 0.55}
        fraction={fraction}
        onInvite={openShare}
      />
      <RoomComposer view={view} session={session} />
      {link && <ShareSheet link={link} onClose={() => setSharing(false)} />}
    </div>
  );
}
