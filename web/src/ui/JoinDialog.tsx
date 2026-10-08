import { useEffect, useRef, useState } from "react";
import { navigate } from "../lib/router";
import { joinFromFragment } from "../state/session";

/** Paste a room link (or just the part after #) to join from this tab. */
export function JoinDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);

  async function join() {
    const raw = value.trim();
    const fragment = raw.includes("#") ? raw.slice(raw.indexOf("#") + 1) : raw;
    setValue("");
    if (await joinFromFragment(fragment)) {
      onClose();
      navigate("/r");
    } else {
      setError("that doesn't look like a melty room link.");
    }
  }

  return (
    <dialog ref={ref} className="sheet panel" aria-labelledby="join-title" onClose={onClose}>
      <div className="sheet__head">
        <h2 id="join-title">join a room</h2>
        <button className="btn btn--ghost" type="button" onClick={onClose} aria-label="close">
          ✕
        </button>
      </div>
      <p className="muted">paste the link someone sent you. it stays in this tab and is cleared from the field right away.</p>
      <form
        className="joinform"
        onSubmit={(e) => {
          e.preventDefault();
          void join();
        }}
      >
        <label className="field">
          <span className="field__label">room link</span>
          <input
            className="input mono"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder={`${location.host}/r#…`}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "join-error" : undefined}
          />
        </label>
        {error && (
          <p id="join-error" className="hint" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn--primary" type="submit" disabled={!value.trim()}>
          join
        </button>
      </form>
    </dialog>
  );
}
