import "@fontsource-variable/quicksand/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./promo.css";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { DURATION, Promo } from "./Promo";

const root = createRoot(document.getElementById("root")!);

declare global {
  interface Window {
    /** render the frame at t seconds, synchronously */
    renderAt: (t: number) => void;
    DURATION: number;
  }
}

window.DURATION = DURATION;
window.renderAt = (t) => flushSync(() => root.render(<Promo t={t} />));
window.renderAt(Number(new URLSearchParams(location.search).get("t") ?? 0));
