/**
 * The ice cube. `left` is the fraction of the room's lifetime that remains
 * (1 = fresh, 0 = gone). Everything is derived from it: the cube shrinks and
 * slumps, a puddle spreads, and at 0 only steam is left.
 *
 * Geometry is drawn on a 200x200 canvas with the cube standing on y=176.
 */
const NAVY = "#0B1530";
const FRONT = "#AEEFF7";
const TOP = "#D4FAFD";
const SIDE = "#6FD6E6";
const GROUND = 176;

export function Mascot({ left, size = 120, className }: { left: number; size?: number; className?: string }) {
  const f = Math.min(1, Math.max(0, left));
  const gone = f <= 0;
  const melt = 1 - f;

  // the cube slumps more than it narrows
  const sx = 0.55 + 0.45 * f;
  const sy = 0.28 + 0.72 * f;
  // keep the face round and readable while the body squashes
  const k = 0.62 + 0.38 * f;
  const faceTransform = `scale(${k / sx}, ${k / sy})`;

  const puddleX = 0.35 + 0.75 * melt;
  const puddleY = 0.45 + 0.75 * melt;

  // the base of the cube spreading out into the puddle
  const W = 100 * sx + 40 * melt;
  const h = 3 + 12 * melt;
  const x0 = 100 - W / 2;
  const x1 = 100 + W / 2;
  const skirt =
    `M${x0} ${GROUND} C${x0 + W * 0.12} ${GROUND - h * 0.15} ${x0 + W * 0.14} ${GROUND - h} ${x0 + W * 0.3} ${GROUND - h} ` +
    `L${x1 - W * 0.3} ${GROUND - h} C${x1 - W * 0.14} ${GROUND - h} ${x1 - W * 0.12} ${GROUND - h * 0.15} ${x1} ${GROUND} Z`;

  return (
    <svg
      className={`mascot${gone ? " mascot--gone" : ""}${className ? ` ${className}` : ""}`}
      viewBox="0 0 200 200"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      {/* puddle */}
      <g className="mascot__puddle" style={{ transform: `scale(${puddleX}, ${puddleY})`, opacity: gone ? undefined : 0.25 + 0.6 * melt }}>
        <ellipse cx="100" cy={GROUND + 2} rx="88" ry="11" fill="var(--puddle)" />
        <ellipse cx="78" cy={GROUND} rx="22" ry="3" fill="#fff" opacity="0.35" />
      </g>

      {!gone && (
        <g className="mascot__body" style={{ transform: `scale(${sx}, ${sy})` }}>
          {/* feet */}
          <rect x="64" y="158" width="20" height="18" rx="9" fill={FRONT} stroke={NAVY} strokeWidth="5" />
          <rect x="112" y="158" width="20" height="18" rx="9" fill={FRONT} stroke={NAVY} strokeWidth="5" />
          {/* silhouette: front + top + right side, rounded */}
          <path
            d="M58 60 L70 51 Q74 48 80 48 L150 48 Q162 48 162 60 L162 142 Q162 149 156 153 L146 160 Q141 164 134 164 L56 164 Q42 164 42 150 L42 76 Q42 66 58 60 Z"
            fill={SIDE}
            stroke={NAVY}
            strokeWidth="6"
            strokeLinejoin="round"
          />
          <path d="M44 72 Q46 64 56 62 L68 53 Q72 50 78 50 L152 50 Q158 50 156 54 L146 62 Q142 66 134 66 L56 66 Z" fill={TOP} />
          <path d="M44 78 Q44 66 56 66 L132 66 Q144 66 144 78 L144 150 Q144 162 132 162 L56 162 Q44 162 44 150 Z" fill={FRONT} />
          {/* edges and shine */}
          <path d="M144 72 L158 60" stroke="#E9FDFF" strokeWidth="3" strokeLinecap="round" opacity="0.8" />
          <path d="M150 74 L150 140" stroke="#E9FDFF" strokeWidth="4" strokeLinecap="round" opacity="0.45" />
          <ellipse cx="60" cy="84" rx="9" ry="5" fill="#fff" opacity="0.85" transform="rotate(-30 60 84)" />
          <circle cx="53" cy="96" r="2.5" fill="#fff" opacity="0.8" />

          {/* face */}
          <g className="mascot__face" style={{ transform: faceTransform }}>
            <ellipse cx="76" cy="114" rx="6.5" ry="8.5" fill={NAVY} />
            <ellipse cx="114" cy="114" rx="6.5" ry="8.5" fill={NAVY} />
            <circle cx="78" cy="110" r="2.2" fill="#fff" />
            <circle cx="116" cy="110" r="2.2" fill="#fff" />
            <ellipse cx="64" cy="128" rx="7.5" ry="4.5" fill="#FFB3C1" opacity="0.9" />
            <ellipse cx="126" cy="128" rx="7.5" ry="4.5" fill="#FFB3C1" opacity="0.9" />
            {f > 0.25 ? (
              <path d="M87 125 Q95 133 103 125" fill="none" stroke={NAVY} strokeWidth="4" strokeLinecap="round" />
            ) : (
              <path d="M88 129 Q95 124 102 129" fill="none" stroke={NAVY} strokeWidth="4" strokeLinecap="round" />
            )}
            {f <= 0.4 && <path className="mascot__sweat" d="M134 92 Q140 102 134 106 Q128 102 134 92 Z" fill="#E9FDFF" stroke={NAVY} strokeWidth="2" />}
          </g>
        </g>
      )}

      {!gone && melt > 0.02 && <path d={skirt} fill={FRONT} />}

      {!gone && f < 0.97 && (
        <g className="mascot__drips">
          <path className="mascot__drip" d="M54 150 Q57 156 54 159 Q51 156 54 150 Z" fill={SIDE} />
          <path className="mascot__drip mascot__drip--late" d="M146 146 Q149 152 146 155 Q143 152 146 146 Z" fill={SIDE} />
        </g>
      )}

      {gone && (
        <g className="mascot__steam" fill="none" stroke="var(--steam)" strokeWidth="5" strokeLinecap="round">
          <path className="mascot__wisp" d="M84 160 Q74 140 86 124 Q98 108 88 90" />
          <path className="mascot__wisp mascot__wisp--2" d="M104 162 Q114 142 102 124 Q92 106 104 84" />
          <path className="mascot__wisp mascot__wisp--3" d="M122 160 Q112 146 122 132 Q130 120 122 106" />
        </g>
      )}
    </svg>
  );
}
