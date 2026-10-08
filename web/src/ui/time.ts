import { useEffect, useState } from "react";

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** "23h 04m", "9:41" */
export function formatLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** coarse, screen-reader friendly: changes at most once a minute */
export function spokenLeft(ms: number): string {
  const min = Math.ceil(ms / 60_000);
  if (ms <= 0) return "the room has melted";
  if (min <= 1) return "less than a minute left";
  if (min < 60) return `about ${min} minutes left`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return `about ${h} hour${h > 1 ? "s" : ""}${rest ? ` ${rest} minutes` : ""} left`;
}

export const TTL_LABELS = { 600: "10 min", 3600: "1 hour", 86400: "24 hours" } as const;
