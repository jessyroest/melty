import "@fontsource-variable/quicksand/wght.css";
import "./styles/tokens.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./styles/app.css";
import "./styles/landing.css";
import "./styles/mascot.css";
import "./styles/hero.css";
import "./styles/never.css";
import "./styles/melt.css";
import "./styles/works.css";
import "./styles/uses.css";
import "./styles/honest.css";
import "./styles/final.css";
import "./styles/room.css";
import "./styles/how.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { navigate } from "./lib/router";
import { joinFromFragment, setNotice, wipeNow } from "./state/session";

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
// closing the tab or navigating away: say bye (best effort) and drop everything
window.addEventListener("pagehide", wipeNow);
// restored from the back/forward cache: the room is already gone
window.addEventListener("pageshow", (e) => {
  if (e.persisted && location.pathname === "/r") navigate("/", { replace: true });
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
