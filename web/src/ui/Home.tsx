import { TTL_OPTIONS, type Ttl } from "@relay/protocol";
import { useState } from "react";
import { navigate } from "../lib/router";
import { createRoom, setNotice } from "../state/session";
import { TTL_LABELS } from "./time";

export function Home({ notice }: { notice: string | null }) {
  const [ttl, setTtl] = useState<Ttl>(3600);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setNotice(null);
    await createRoom(ttl);
  }

  return (
    <div className="home">
      <section className="hero">
        <div className="hero__text">
          <h1 className="hero__title">
            chats that <span className="accent">melt</span>.
          </h1>
          <p className="hero__lead">
            open a room, share the link, talk. when the timer runs out the room is gone, for everyone.
          </p>

          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}

          <form
            className="panel start"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <fieldset className="ttl">
              <legend>melts in</legend>
              <div className="ttl__options">
                {TTL_OPTIONS.map((t) => (
                  <label key={t} className="ttl__option">
                    <input type="radio" name="ttl" value={t} checked={ttl === t} onChange={() => setTtl(t)} />
                    <span>{TTL_LABELS[t]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="btn btn--primary btn--big" type="submit" disabled={busy}>
              {busy ? "freezing…" : "open a room"}
            </button>
          </form>

          <ul className="facts">
            <li>no account</li>
            <li>end-to-end encrypted</li>
            <li>messages aren't stored on the server</li>
            <li>max 8 people</li>
          </ul>
          <p className="hero__more">
            <a
              href="/how"
              onClick={(e) => {
                e.preventDefault();
                navigate("/how");
              }}
            >
              how it works, and what it doesn't protect against →
            </a>
          </p>
        </div>
        <div className="hero__art" aria-hidden="true">
          <img src="/brand/hero.webp" alt="" width="1344" height="752" decoding="async" />
        </div>
      </section>
    </div>
  );
}
