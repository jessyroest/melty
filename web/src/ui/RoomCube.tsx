/** A stable hue (0..359) for a nickname, so the same person keeps their colour. */
export function nickHue(nick: string): number {
  let h = 2166136261;
  for (let i = 0; i < nick.length; i++) {
    h ^= nick.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}

/** A tiny ice-cube avatar, tinted by `--hue` (set it on the element or a parent). */
export function RoomCube({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={`r-cube${className ? ` ${className}` : ""}`}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path className="r-cube__side" d="M7 9.5 9.5 7h16A2.5 2.5 0 0 1 28 9.5v13.5l-2.5 2.5H7z" />
      <rect className="r-cube__front" x="4" y="9.5" width="21" height="18.5" rx="5" />
      <path className="r-cube__shine" d="M8 13.5q.6-1.6 2.2-2" />
      <circle className="r-cube__eye" cx="11.4" cy="18.6" r="1.6" />
      <circle className="r-cube__eye" cx="17.6" cy="18.6" r="1.6" />
      <path className="r-cube__mouth" d="M13.2 22q1.3 1.2 2.6 0" />
    </svg>
  );
}
