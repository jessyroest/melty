import { useEffect, useState } from "react";
import { navigate, useRoute } from "./lib/router";
import { resetToStart, retryRoom, useStore } from "./state/session";
import { Chat } from "./ui/Chat";
import { focusStart, Home } from "./ui/Home";
import { HowItWorks } from "./ui/HowItWorks";
import { JoinDialog } from "./ui/JoinDialog";
import { Logo } from "./ui/Logo";
import { RoomError } from "./ui/RoomError";

export function App() {
  const route = useRoute();
  const { notice, error } = useStore();
  // a room that ended badly (or can't start) gets its own screen, on "/" or "/r"
  const showError = error !== null && route !== "/how";
  const [joining, setJoining] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(scrollY > 8);
    on();
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, []);

  // walking away from an error screen clears it (and wipes a paused session's key)
  useEffect(() => {
    if (route === "/how" && error !== null) resetToStart();
  }, [route, error]);

  function openRoom() {
    if (error !== null) resetToStart();
    else if (route === "/") return focusStart();
    navigate("/", { replace: route === "/r" && error !== null });
    requestAnimationFrame(() => requestAnimationFrame(focusStart));
  }

  return (
    <div className={`app app--${showError ? "page app--error" : route === "/r" ? "room" : route === "/" ? "home" : "page"}`}>
      <a className="skip" href="#main">
        skip to content
      </a>
      <header className={`topnav${scrolled ? " is-scrolled" : ""}`}>
        <nav className="topnav__inner" aria-label="main">
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              if (showError) {
                resetToStart();
                navigate("/", { replace: route === "/r" });
              } else if (route !== "/r") navigate("/");
            }}
            aria-current={route === "/" ? "page" : undefined}
          >
            <Logo size={34} />
          </a>
          {route !== "/r" && (
            <div className="topnav__links">
              <a
                href="/how"
                onClick={(e) => {
                  e.preventDefault();
                  navigate("/how");
                }}
                aria-current={route === "/how" ? "page" : undefined}
              >
                how it works
              </a>
              <button className="btn btn--ghost btn--small hide-sm" type="button" onClick={() => setJoining(true)}>
                join a room
              </button>
              <button className="btn btn--primary btn--small" type="button" onClick={openRoom}>
                open a room
              </button>
            </div>
          )}
        </nav>
      </header>
      <main id="main">
        {showError && error && (
          <RoomError
            kind={error}
            notice={notice}
            onNewRoom={openRoom}
            onRetry={retryRoom}
            onJoin={() => setJoining(true)}
            onHome={() => {
              resetToStart();
              navigate("/", { replace: route === "/r" });
            }}
          />
        )}
        {!showError && route === "/" && <Home notice={notice} onJoin={() => setJoining(true)} />}
        {!showError && route === "/r" && <Chat />}
        {route === "/how" && <HowItWorks />}
      </main>
      {joining && <JoinDialog onClose={() => setJoining(false)} />}
    </div>
  );
}
