import { useEffect, useState } from "react";
import { navigate, useRoute } from "./lib/router";
import { useStore } from "./state/session";
import { Chat } from "./ui/Chat";
import { focusStart, Home } from "./ui/Home";
import { HowItWorks } from "./ui/HowItWorks";
import { JoinDialog } from "./ui/JoinDialog";
import { LiveMascot } from "./ui/LiveMascot";

export function App() {
  const route = useRoute();
  const { notice } = useStore();
  const [joining, setJoining] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(scrollY > 8);
    on();
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, []);

  function openRoom() {
    if (route === "/") return focusStart();
    navigate("/");
    requestAnimationFrame(() => requestAnimationFrame(focusStart));
  }

  return (
    <div className={`app app--${route === "/r" ? "room" : route === "/" ? "home" : "page"}`}>
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
              if (route !== "/r") navigate("/");
            }}
            aria-current={route === "/" ? "page" : undefined}
          >
            <LiveMascot size={34} className="brand__mascot" />
            <span>melty</span>
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
        {route === "/" && <Home notice={notice} onJoin={() => setJoining(true)} />}
        {route === "/r" && <Chat />}
        {route === "/how" && <HowItWorks />}
      </main>
      {joining && <JoinDialog onClose={() => setJoining(false)} />}
    </div>
  );
}
