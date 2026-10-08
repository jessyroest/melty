import { useSyncExternalStore } from "react";

export type Route = "/" | "/r" | "/how";
const ROUTES = new Set<string>(["/", "/r", "/how"]);

const listeners = new Set<() => void>();
window.addEventListener("popstate", () => listeners.forEach((l) => l()));

function current(): Route {
  const p = location.pathname;
  return (ROUTES.has(p) ? p : "/") as Route;
}

export function navigate(to: Route, opts: { replace?: boolean } = {}): void {
  if (opts.replace) history.replaceState(null, "", to);
  else if (location.pathname !== to) history.pushState(null, "", to);
  listeners.forEach((l) => l());
  window.scrollTo(0, 0);
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    current,
  );
}
