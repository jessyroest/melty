import "@fontsource-variable/quicksand/wght.css";
import "./styles/tokens.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./styles/app.css";
import "./styles/landing.css";
import "./styles/mascot.css";
import "./styles/logo.css";
import "./styles/hero.css";
import "./styles/never.css";
import "./styles/melt.css";
import "./styles/works.css";
import "./styles/uses.css";
import "./styles/honest.css";
import "./styles/final.css";
import "./styles/room.css";
import "./styles/how.css";
import "./styles/error.css";
import "./styles/door.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { navigate } from "./lib/router";
import { joinFromFragment, networkDown, resetToStart, setNotice, wake, wipeNow } from "./state/session";

/**
 * A room link looks like /r#<secret>. Read the fragment once, then take it out
 * of the address bar so it isn't left sitting there (or re-copied by accident).
 */
async function takeFragment(): Promise<void> {
  const fragment = location.hash.slice(1);
  if (!fragment) return;
  history.replaceState(null, "", location.pathname);
  if (location.pathname !== "/r") return;
  if (await joinFromFragment(fragment)) {
    navigate("/r", { replace: true });
  } else {
    setNotice("that link doesn't look right.");
    navigate("/", { replace: true });
  }
}

void takeFragment();
// someone pastes a different room link into the same tab
window.addEventListener("hashchange", () => void takeFragment());
// closing the tab, navigating away or going into the back/forward cache: send the
// pre-sealed goodbye and wipe everything, synchronously (nothing awaits on this path)
window.addEventListener("pagehide", wipeNow);
// restored from the back/forward cache: the room is already gone; show a clean start screen
window.addEventListener("pageshow", (e) => {
  if (!e.persisted) return;
  resetToStart();
  if (location.pathname === "/r") navigate("/", { replace: true });
});
// real life: wifi drops, phones sleep. Reconnect right away when things come back.
window.addEventListener("online", () => wake("online"));
window.addEventListener("offline", networkDown);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") wake("visible");
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
