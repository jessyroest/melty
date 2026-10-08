import type { CSSProperties } from "react";

const v = (vars: Record<string, string | number>) => vars as CSSProperties;

/** a line of the headline, one span per word so each can condense out of the frost */
export function HeroWords({ text, from = 0 }: { text: string; from?: number }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          <span className="hw" style={v({ "--w": from + i })}>
            {w}
          </span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </>
  );
}

/** how long one melt loop of the little cube takes, per room lifetime */
const MELT_LOOP: Record<number, string> = { 600: "1.5s", 3600: "3.4s", 86400: "8s" };

/** a tiny ice cube that melts at the speed of the option it sits in */
export function TtlCube({ ttl }: { ttl: number }) {
  return (
    <svg className="ttl-cube" viewBox="0 0 30 28" width="30" height="28" aria-hidden="true" focusable="false" style={v({ "--loop": MELT_LOOP[ttl] ?? "3s" })}>
      <ellipse className="ttl-cube__puddle" cx="14.5" cy="25" rx="13" ry="2.4" />
      <g className="ttl-cube__body">
        <path className="ttl-cube__side" d="M5 9.5 L9.5 5 H24 Q25 5 25 6 V19 L20.5 23.5 H6.5 Q5 23.5 5 22 Z" />
        <path className="ttl-cube__top" d="M6.2 9.4 L9.8 6.2 H23.4 L19.9 9.4 Z" />
        <rect className="ttl-cube__front" x="5" y="9.5" width="15.5" height="14" rx="2.2" />
        <circle className="ttl-cube__eye" cx="10.3" cy="16.4" r="1.15" />
        <circle className="ttl-cube__eye" cx="15.2" cy="16.4" r="1.15" />
        <path className="ttl-cube__shine" d="M7.6 12.6 Q8 11.6 9.2 11.4" />
      </g>
      <path className="ttl-cube__drip" d="M22.6 17 Q24.2 19.8 22.6 20.8 Q21 19.8 22.6 17 Z" />
    </svg>
  );
}

/** spins while the room is being made */
export function Snowflake() {
  return (
    <svg className="snowflake" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7" />
        <path d="M9.5 3.8 12 6l2.5-2.2M9.5 20.2 12 18l2.5 2.2M3.6 10.6l3.2-.8-1-3.1M20.4 13.4l-3.2.8 1 3.1M3.6 13.4l3.2.8-1 3.1M20.4 10.6l-3.2-.8 1-3.1" />
      </g>
    </svg>
  );
}

/** hairline cracks that shoot across the button while it is pressed */
export function Crack() {
  return (
    <svg className="crack" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path pathLength="1" d="M200 30 L176 22 L150 26 L122 12 L96 16 L70 4" />
        <path pathLength="1" d="M200 30 L226 40 L252 34 L280 50 L310 46 L336 58" />
        <path pathLength="1" d="M200 30 L212 14 L236 10 L252 0" />
        <path pathLength="1" d="M200 30 L186 44 L160 48 L144 60" />
        <path pathLength="1" d="M150 26 L140 40 M280 50 L292 34 M122 12 L116 0" />
      </g>
    </svg>
  );
}
