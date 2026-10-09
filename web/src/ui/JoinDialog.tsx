import { useEffect, useRef, useState } from "react";
import { navigate } from "../lib/router";
import { looksLikeWords, parseDoorCode } from "../crypto/words";
import { joinFromFragment, joinWithWords } from "../state/session";
import { Mascot } from "./Mascot";
import { CloseIcon, LinkIcon } from "./RoomIcons";
import { useSheet } from "./RoomSheet";

/** Paste a room link (or just the part after #), or type the room's 4 words, to join from this tab. */
export function JoinDialog({ onClose }: { onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const { ref, onClick } = useSheet(onClose, input);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

  async function join() {
    // read the DOM value and empty the field right away, before anything else happens: a browser
    // that remembers form entries (Edge does, even with autocomplete="off") finds nothing to keep
    const el = input.current;
    const raw = (el?.value ?? value).trim();
    if (!raw) return;
    if (el) el.value = "";
    setValue("");
    if (looksLikeWords(raw)) {
      const code = parseDoorCode(raw);
      if (code) {
        joinWithWords(code);
        onClose();
        navigate("/r");
      } else {
        setError("that's not 4 words from melty's list. check the spelling.");
        setTries((t) => t + 1);
      }
      return;
    }
    const fragment = raw.includes("#") ? raw.slice(raw.indexOf("#") + 1) : raw;
    if (await joinFromFragment(fragment)) {
      onClose();
      navigate("/r");
    } else {
      setError("that doesn't look like a melty room link, or 4 words.");
      setTries((t) => t + 1);
    }
  }

  // the field is re-mounted to replay the shake; put the cursor back in it
  useEffect(() => {
    if (tries) input.current?.focus();
  }, [tries]);

  return (
    <dialog ref={ref} className="sheet sheet--join" aria-labelledby="join-title" onClose={onClose} onClick={onClick}>
      <div className="sheet__head">
        <div className="sheet__titled">
          <Mascot left={1} size={52} className="sheet__mascot" />
          <div>
            <span className="sheet__kicker mono">join</span>
            <h2 id="join-title">join a room</h2>
          </div>
        </div>
        <button className="sheet__close" type="button" onClick={onClose} aria-label="close">
          <CloseIcon />
        </button>
      </div>
      <p className="sheet__lead">
        paste the link someone sent you, or type the 4 words they told you. it stays in this tab and is cleared from
        the field right away.
      </p>
      {/* deliberately not a <form>: a submit event is what browsers hook to save field values */}
      <div className="joinform">
        <label className="field">
          <span className="field__label">room link or 4 words</span>
          <span key={tries} className={`joinform__box${error ? " is-wrong" : ""}`}>
            <LinkIcon className="joinform__icon" />
            <input
              ref={input}
              className="input mono joinform__input"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              placeholder={`${location.host}/r#…  or  four words like this`}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void join();
                }
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "join-error" : undefined}
            />
          </span>
        </label>
        {error && (
          <p id="join-error" className="joinform__error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--primary joinform__go" type="button" onClick={() => void join()} disabled={!value.trim()}>
          join
        </button>
      </div>
    </dialog>
  );
}
