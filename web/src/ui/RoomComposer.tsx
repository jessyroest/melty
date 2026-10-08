import { MAX_PLAINTEXT_BYTES } from "@relay/protocol";
import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { encodedSize, MAX_NICK } from "../crypto/message";
import type { useStore, View } from "../state/session";
import { nickHue, RoomCube } from "./RoomCube";
import { CheckIcon, FlameIcon, PencilIcon, SendIcon } from "./RoomIcons";

type SessionApi = NonNullable<ReturnType<typeof useStore>["session"]>;

const MAX_HEIGHT = 168;

export function RoomComposer({ view, session }: { view: View; session: SessionApi }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(0);
  const [burn, setBurn] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const size = encodedSize({
    v: 1,
    kind: "chat",
    id: "xxxxxxxxxxx",
    nick: view.nick,
    text,
    ts: Date.now(),
    ...(burn ? { burn: true as const } : {}),
  });
  const nearLimit = size > MAX_PLAINTEXT_BYTES * 0.8;
  const over = size > MAX_PLAINTEXT_BYTES;
  const live = view.status === "live";
  const canSend = live && text.trim().length > 0 && !over;

  // grow with the text, up to a few lines, then scroll
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    const h = el.scrollHeight;
    el.style.height = `${Math.min(h, MAX_HEIGHT)}px`;
    el.style.overflowY = h > MAX_HEIGHT ? "auto" : "hidden";
  }, [text]);

  async function submit() {
    if (!canSend) return;
    const draft = text;
    if (await session.send(draft, { burn })) {
      setText((t) => (t === draft ? "" : t));
      setSent((s) => s + 1);
      setBurn(false);
    }
  }

  return (
    <div className="composer panel">
      <div className="composer__toast" role="status">
        {view.hint && <span className="r-toast">{view.hint}</span>}
      </div>

      <div className="composer__top">
        <NickChip nick={view.nick} onSave={(n) => void session.setNick(n)} />
        <Typing who={view.typing} />
        <span className="composer__keys mono" aria-hidden="true">
          <kbd>enter</kbd> send · <kbd>shift</kbd>+<kbd>enter</kbd> new line
        </span>
        {nearLimit && (
          <span id="msg-size" className={`r-bytes mono${over ? " r-bytes--over" : ""}`}>
            <span className="r-bytes__bar" aria-hidden="true">
              <span style={{ transform: `scaleX(${Math.min(1, size / MAX_PLAINTEXT_BYTES)})` }} />
            </span>
            {over ? "too long · " : ""}
            {(size / 1024).toFixed(1)} / {MAX_PLAINTEXT_BYTES / 1024} KB
          </span>
        )}
      </div>

      <form
        className={`composer__field${over ? " is-over" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor="msg">
          message
        </label>
        <textarea
          ref={ta}
          id="msg"
          className="composer__input"
          rows={1}
          value={text}
          placeholder={
            live ? "write something. it won't last." : view.status === "reconnecting" ? "reconnecting…" : "connecting…"
          }
          autoComplete="off"
          enterKeyHint="send"
          spellCheck
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) session.typing();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          aria-describedby={nearLimit ? "msg-size" : undefined}
        />
        <button
          className={`r-burnbtn${burn ? " is-on" : ""}`}
          type="button"
          aria-pressed={burn}
          aria-label="burn after reading"
          title={burn ? "burn after reading: on" : "burn after reading"}
          onClick={() => setBurn((b) => !b)}
        >
          <FlameIcon />
        </button>
        <button
          className={`r-send${canSend ? " is-ready" : ""}${burn ? " is-burn" : ""}`}
          type="submit"
          disabled={!canSend}
          aria-label="send message"
        >
          <span key={sent} className={`r-send__icon${sent ? " is-launched" : ""}`}>
            <SendIcon />
          </span>
          {sent > 0 && <span key={`r${sent}`} className="r-send__ripple" aria-hidden="true" />}
        </button>
      </form>
    </div>
  );
}

/** "quiet-otter is typing…", built from encrypted typing notices */
function Typing({ who }: { who: string[] }) {
  const text =
    who.length === 0
      ? ""
      : who.length === 1
        ? `${who[0]} is typing`
        : who.length === 2
          ? `${who[0]} and ${who[1]} are typing`
          : `${who.length} people are typing`;
  return (
    <span className={`r-typing${text ? " is-on" : ""}`} aria-live="polite">
      {text && (
        <>
          <span className="r-typing__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {text}
        </>
      )}
    </span>
  );
}

/** your name as a chip; click it and it becomes an input right where it is */
function NickChip({ nick, onSave }: { nick: string; onSave: (nick: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nick);
  const open = useRef(false);
  const chip = useRef<HTMLButtonElement>(null);
  const style = { "--hue": nickHue(editing ? draft || nick : nick) } as CSSProperties;

  function finish(save: boolean, refocus: boolean) {
    if (!open.current) return;
    open.current = false;
    setEditing(false);
    if (save && draft.trim()) onSave(draft);
    if (refocus) requestAnimationFrame(() => chip.current?.focus());
  }

  if (editing) {
    return (
      <form
        className="r-nick r-nick--editing"
        style={style}
        onSubmit={(e) => {
          e.preventDefault();
          finish(true, true);
        }}
      >
        <RoomCube size={20} />
        <label className="sr-only" htmlFor="nick">
          your nickname
        </label>
        <input
          id="nick"
          className="r-nick__input"
          value={draft}
          maxLength={MAX_NICK}
          size={Math.max(4, draft.length + 1)}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              finish(false, true);
            }
          }}
          onBlur={() => finish(true, false)}
        />
        <button
          className="r-nick__save"
          type="submit"
          aria-label="save nickname"
          onMouseDown={(e) => e.preventDefault()}
        >
          <CheckIcon />
        </button>
      </form>
    );
  }

  return (
    <button
      ref={chip}
      className="r-nick"
      style={style}
      type="button"
      onClick={() => {
        setDraft(nick);
        open.current = true;
        setEditing(true);
      }}
      aria-label={`your nickname is ${nick}. change it`}
    >
      <RoomCube size={20} />
      <span className="r-nick__name">{nick}</span>
      <PencilIcon className="r-nick__pen" />
    </button>
  );
}
