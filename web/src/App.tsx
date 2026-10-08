import { navigate, useRoute } from "./lib/router";
import { useStore } from "./state/session";
import { Chat } from "./ui/Chat";
import { Home } from "./ui/Home";
import { HowItWorks } from "./ui/HowItWorks";
import { Mascot } from "./ui/Mascot";

export function App() {
  const route = useRoute();
  const { notice } = useStore();

  return (
    <div className={`app app--${route === "/r" ? "room" : "page"}`}>
      <a className="skip" href="#main">
        skip to content
      </a>
      <nav className="topnav" aria-label="main">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            if (route !== "/r") navigate("/");
          }}
          aria-current={route === "/" ? "page" : undefined}
        >
          <Mascot left={1} size={30} />
          <span>PROJECTNAAM</span>
        </a>
        {route !== "/r" && (
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
        )}
      </nav>
      <main id="main">
        {route === "/" && <Home notice={notice} />}
        {route === "/r" && <Chat />}
        {route === "/how" && <HowItWorks />}
      </main>
    </div>
  );
}
