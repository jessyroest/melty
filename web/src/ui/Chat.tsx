import { MAX_PARTICIPANTS, MAX_PLAINTEXT_BYTES } from "@relay/protocol";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { encodedSize, MAX_NICK } from "../crypto/message";
import { navigate } from "../lib/router";
import type { View } from "../state/session";
import { useStore } from "../state/session";
import { LiveMascot } from "./LiveMascot";
import { Mascot } from "./Mascot";
import { ShareSheet } from "./ShareSheet";
import { formatLeft, spokenLeft, useNow } from "./time";

export function Chat() {
  const { session, view } = useStore();
  if (!session || !view) return <NoRoom />;
  return <Room view={view} session={session} />;
}

function NoRoom() {
  return (
    <div className="empty panel">
      <Mascot left={0} size={96} />
      <h1>nothing here</h1>
      <p>rooms only live in memory. if you had one open in this tab, it's gone. open the original link again to rejoin.</p>
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
  const melt = view.expiresAt === null ? 0 : 1 - fraction;

  // the countdown in the tab title, so you can see it from another tab
  useEffect(() => {
    if (view.expiresAt !== null) document.title = `${formatLeft(leftMs)} · melty`;
  }, [leftMs, view.expiresAt]);
  useEffect(() => {
    const prev = document.title;
    return () => {
      document.title = prev;
    };
  }, []);
  const shownOnce = useRef(false);

  // the creator gets the invite sheet once, right away
  useEffect(() => {
    if (view.isCreator && view.status === "live" && !shownOnce.current) {
      shownOnce.current = true;
      setSharing(true);
    }
  }, [view.isCreator, view.status]);

  const link = sharing ? session.shareLink() : null;

  return (
    <div className="room">
      <RoomBar view={view} onShare={() => setSharing(true)} onLeave={() => void session.leave("you left. nothing was kept.")} />
      <Messages view={view} melt={melt} />
      <Composer view={view} session={session} />
      {link && <ShareSheet link={link} onClose={() => setSharing(false)} />}
    </div>
  );
}

function RoomBar({ view, onShare, onLeave }: { view: View; onShare: () => void; onLeave: () => void }) {
  const now = useNow(1000);
  const known = view.expiresAt !== null && view.ttlMs !== null;
  const { leftMs, fraction } = timeLeft(view, now);
  const spoken = known ? spokenLeft(leftMs) : "";

  return (
    <header className="roombar panel">
      <LiveMascot left={fraction} size={76} className="roombar__mascot" bump={view.lines.length} />
      <div className="roombar__info">
        <div className="roombar__time" role="timer" aria-hidden="true">
          {known ? formatLeft(leftMs) : "…"}
          <span className="roombar__suffix"> left</span>
        </div>
        <span className="sr-only" aria-live="polite">
          {spoken}
        </span>
        <div className="roombar__meta">
          <span>
            {view.n} of {MAX_PARTICIPANTS} here
          </span>
          <span className="dot" aria-hidden="true">
            ·
          </span>
          <span>end-to-end encrypted</span>
          {view.status !== "live" && (
            <>
              <span className="dot" aria-hidden="true">
                ·
              </span>
              <span className="pulse">{view.status === "connecting" ? "connecting…" : "reconnecting…"}</span>
            </>
          )}
        </div>
      </div>
      <div className="roombar__actions">
        <button className="btn btn--primary" type="button" onClick={onShare}>
          invite
        </button>
        <button className="btn btn--ghost" type="button" onClick={onLeave}>
          leave
        </button>
      </div>
    </header>
  );
}

function timeLeft(view: View, now: number): { leftMs: number; fraction: number } {
  if (view.expiresAt === null || view.ttlMs === null) return { leftMs: 0, fraction: 1 };
  const leftMs = view.expiresAt - (now + view.offset);
  return { leftMs, fraction: Math.max(0, Math.min(1, leftMs / view.ttlMs)) };
}

function Messages({ view, melt }: { view: View; melt: number }) {
  const end = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [view.lines.length]);

  return (
    <div
      className="messages panel"
      role="log"
      aria-live="polite"
      aria-label="messages"
      style={{ ["--water" as string]: (melt * 0.55).toFixed(4) }}
    >
      {view.lines.length === 0 && (
        <p className="messages__empty">
          {view.isCreator ? "it's quiet. invite someone." : "it's quiet. say hi."}
          <br />
          <span className="muted">you won't see anything sent before you joined.</span>
        </p>
      )}
      {view.lines.map((l) =>
        l.kind === "system" ? (
          <p key={l.id} className="line line--system">
            {l.text}
          </p>
        ) : (
          <div key={l.id} className={`line line--chat${l.mine ? " line--mine" : ""}`}>
            <span className="line__nick">{l.mine ? `${l.nick} (you)` : l.nick}</span>
            <p className="line__text">{l.text}</p>
          </div>
        ),
      )}
      <div ref={end} />
    </div>
  );
}

function Composer({ view, session }: { view: View; session: SessionApi }) {
  const [text, setText] = useState("");
  const [editingNick, setEditingNick] = useState(false);
  const [nickDraft, setNickDraft] = useState(view.nick);
  const size = encodedSize({ v: 1, kind: "chat", nick: view.nick, text, ts: Date.now() });
  const nearLimit = size > MAX_PLAINTEXT_BYTES * 0.8;
  const over = size > MAX_PLAINTEXT_BYTES;
  const canSend = view.status === "live" && text.trim().length > 0 && !over;

  async function submit() {
    if (!canSend) return;
    if (await session.send(text)) setText("");
  }

  return (
    <div className="composer panel">
      <div className="composer__nick">
        {editingNick ? (
          <form
            className="nickform"
            onSubmit={(e) => {
              e.preventDefault();
              void session.setNick(nickDraft);
              setEditingNick(false);
            }}
          >
            <label className="sr-only" htmlFor="nick">
              your nickname
            </label>
            <input
              id="nick"
              className="input input--small"
              value={nickDraft}
              maxLength={MAX_NICK}
              autoComplete="off"
              autoFocus
              onChange={(e) => setNickDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setEditingNick(false)}
            />
            <button className="btn btn--small" type="submit">
              save
            </button>
          </form>
        ) : (
          <button
            className="chip"
            type="button"
            onClick={() => {
              setNickDraft(view.nick);
              setEditingNick(true);
            }}
            aria-label={`your nickname is ${view.nick}. change it`}
          >
            {view.nick} <span aria-hidden="true">✎</span>
          </button>
        )}
        {view.hint && (
          <span className="hint" role="status">
            {view.hint}
          </span>
        )}
      </div>
      <form
        className="composer__row"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor="msg">
          message
        </label>
        <textarea
          id="msg"
          className="input composer__input"
          rows={1}
          value={text}
          placeholder="type a message"
          autoComplete="off"
          spellCheck
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          aria-describedby={nearLimit ? "msg-size" : undefined}
        />
        <button className="btn btn--primary" type="submit" disabled={!canSend}>
          send
        </button>
      </form>
      {nearLimit && (
        <p id="msg-size" className={`size${over ? " size--over" : ""}`}>
          {size} / {MAX_PLAINTEXT_BYTES} bytes
        </p>
      )}
    </div>
  );
}
