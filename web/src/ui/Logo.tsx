import { LiveMascot } from "./LiveMascot";

const LETTERS = ["m", "e", "l", "t"];

type Props = {
  /** cube size in px; the wordmark scales with it (34 in the nav, ~28 in the footer) */
  size?: number;
  className?: string;
};

/** The wordmark: the live cube plus "melty", with a drop slowly forming under the y. */
export function Logo({ size = 34, className }: Props) {
  return (
    <span className={`logo${className ? ` ${className}` : ""}`} style={{ ["--logo" as string]: `${size}px` }}>
      <LiveMascot size={size} className="logo__cube" />
      <span className="logo__word" aria-hidden="true">
        {LETTERS.map((c, i) => (
          <span key={c} className="logo__l" style={{ ["--i" as string]: i }}>
            {c}
          </span>
        ))}
        <span className="logo__l logo__y" style={{ ["--i" as string]: 4 }}>
          y<span className="logo__drip" />
        </span>
      </span>
      <span className="sr-only">melty</span>
    </span>
  );
}
