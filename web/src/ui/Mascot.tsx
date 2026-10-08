/**
 * The ice cube. `left` is the fraction of the room's lifetime that remains
 * (1 = fresh, 0 = gone). Everything is derived from it: the cube shrinks and
 * slumps, a puddle spreads, and at 0 only steam is left.
 *
 * `look` moves the pupils (-1..1 on both axes), `blink` closes the eyes and
 * `mood` swaps the face. `crack` draws a small crack in the ice. Geometry is
 * drawn on a 200x200 canvas with the cube standing on y=176.
 */
export type Mood = "happy" | "surprised" | "squint" | "wink" | "sleepy" | "wide" | "dizzy";

const NAVY = "#0B1530";
const FRONT = "#AEEFF7";
const TOP = "#D4FAFD";
const SIDE = "#6FD6E6";
const SHINE = "#E9FDFF";
const BLUSH = "#FFB3C1";
const TONGUE = "#FF8FA3";
const GROUND = 176;
const EY = 114;

type Props = {
  left: number;
  size?: number;
  className?: string;
  look?: { x: number; y: number };
  blink?: boolean;
  mood?: Mood;
  crack?: boolean;
};

type EyeKind = "open" | "big" | "arc" | "lid" | "wide" | "spiral";

function Eye({ cx, kind, blink, look }: { cx: number; kind: EyeKind; blink: boolean; look: { x: number; y: number } }) {
  switch (kind) {
    case "arc":
      return <path d={`M${cx - 7.5} ${EY + 2} Q${cx} ${EY - 9} ${cx + 7.5} ${EY + 2}`} fill="none" stroke={NAVY} strokeWidth="4.5" strokeLinecap="round" />;
    case "lid":
      return (
        <g>
          <path d={`M${cx - 7} ${EY + 1} A7 6.5 0 0 0 ${cx + 7} ${EY + 1} Z`} fill={NAVY} />
          <path d={`M${cx - 8.5} ${EY + 1} L${cx + 8.5} ${EY + 1}`} stroke={NAVY} strokeWidth="3.5" strokeLinecap="round" />
        </g>
      );
    case "wide":
      return (
        <g className="mascot__eye" style={{ transform: `scaleY(${blink ? 0.12 : 1})` }}>
          <circle cx={cx} cy={EY - 1} r="10" fill="#fff" stroke={NAVY} strokeWidth="3.5" />
          <circle cx={cx + look.x * 3} cy={EY - 1 + look.y * 3} r="3.6" fill={NAVY} />
        </g>
      );
    case "spiral":
      return (
        <g className="mascot__spiral">
          <path
            d={`M${cx} ${EY} A1.6 1.6 0 0 1 ${cx + 3.2} ${EY} A3.2 3.2 0 0 1 ${cx - 3.2} ${EY} A4.8 4.8 0 0 1 ${cx + 6.4} ${EY} A6.4 6.4 0 0 1 ${cx - 6.4} ${EY}`}
            fill="none"
            stroke={NAVY}
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>
      );
    default: {
      const big = kind === "big";
      return (
        <g className="mascot__eye" style={{ transform: `scaleY(${blink ? 0.12 : 1})` }}>
          <ellipse cx={cx} cy={EY} rx={big ? 7.5 : 6.5} ry={big ? 9.8 : 8.5} fill={NAVY} />
          {!blink && <circle cx={cx + 2} cy={EY - 4} r={big ? 2.6 : 2.2} fill="#fff" />}
          {!blink && <circle cx={cx - 2.2} cy={EY + 3.6} r="1" fill="#fff" opacity="0.7" />}
        </g>
      );
    }
  }
}

function eyesFor(mood: Mood): [EyeKind, EyeKind] {
  switch (mood) {
    case "surprised":
      return ["big", "big"];
    case "squint":
      return ["arc", "arc"];
    case "wink":
      return ["open", "arc"];
    case "sleepy":
      return ["lid", "lid"];
    case "wide":
      return ["wide", "wide"];
    case "dizzy":
      return ["spiral", "spiral"];
    default:
      return ["open", "open"];
  }
}

function Mouth({ mood, f }: { mood: Mood; f: number }) {
  const line = { fill: "none", stroke: NAVY, strokeWidth: 4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (mood) {
    case "surprised":
      return <ellipse cx="95" cy="129" rx="5" ry="6" fill={NAVY} />;
    case "squint":
      return (
        <g>
          <path d="M85.5 124 Q95 139 104.5 124 Z" fill={NAVY} stroke={NAVY} strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M89.5 130.5 Q95 127.5 100.5 130.5 Q95 135.5 89.5 130.5 Z" fill={TONGUE} />
        </g>
      );
    case "wink":
      return <path d="M86 125 Q96 134 104.5 122.5" {...line} />;
    case "sleepy":
      return <ellipse className="mascot__snore" cx="95" cy="129" rx="2.8" ry="3.4" fill={NAVY} />;
    case "wide":
      return <path d="M84 129 q2.75 -3.2 5.5 0 t5.5 0 t5.5 0 t5.5 0" {...line} strokeWidth={3.5} />;
    case "dizzy":
      return <path d="M86 128 q4.5 -4.5 9 0 t9 0" {...line} strokeWidth={3.5} />;
    default:
      return f > 0.25 ? <path d="M87 125 Q95 133 103 125" {...line} /> : <path d="M88 129 Q95 124 102 129" {...line} />;
  }
}

export function Mascot({ left, size = 120, className, look, blink = false, mood = "happy", crack = false }: Props) {
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

  const lk = look ?? { x: 0, y: 0 };
  const [eyeL, eyeR] = eyesFor(mood);
  // pupils only wander when the eyes are open
  const tracks = eyeL === "open" || eyeL === "big" || eyeL === "wide";
  const px = tracks ? lk.x * 3.5 : 0;
  const py = tracks ? lk.y * 3 : 0;
  const glow = mood === "squint" || mood === "wink";

  // the top-right corner of the cube, for the z's
  const topY = GROUND - 128 * sy;
  const rightX = 100 + 62 * sx;

  return (
    <svg
      className={`mascot mascot--${mood}${gone ? " mascot--gone" : ""}${className ? ` ${className}` : ""}`}
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
          <path d="M144 72 L158 60" stroke={SHINE} strokeWidth="3" strokeLinecap="round" opacity="0.8" />
          <path d="M150 74 L150 140" stroke={SHINE} strokeWidth="4" strokeLinecap="round" opacity="0.45" />
          <path d="M58 150 Q100 156 132 150" stroke={SIDE} strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.45" />
          <ellipse className="mascot__glint" cx="60" cy="84" rx="9" ry="5" fill="#fff" opacity="0.85" transform="rotate(-30 60 84)" />
          <circle cx="53" cy="96" r="2.5" fill="#fff" opacity="0.8" />

          {crack && (
            <g className="mascot__crack" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M142.5 68 L135 78 L140 83 L132 94 L136 99 L130 107" stroke="#fff" strokeWidth="1.6" opacity="0.9" transform="translate(1.6 0.6)" />
              <path d="M142.5 68 L135 78 L140 83 L132 94 L136 99 L130 107 M135 78 L128 80 M132 94 L126.5 92.5" stroke={NAVY} strokeWidth="2.2" />
            </g>
          )}

          {/* face */}
          <g className="mascot__face" style={{ transform: faceTransform }}>
            <g className="mascot__eyes" style={{ transform: `translate(${px}px, ${py}px)` }}>
              <Eye cx={76} kind={eyeL} blink={blink} look={lk} />
              <Eye cx={114} kind={eyeR} blink={blink} look={lk} />
            </g>
            <ellipse cx="64" cy="128" rx={glow ? 8.5 : 7.5} ry={glow ? 5 : 4.5} fill={BLUSH} opacity={glow ? 1 : 0.9} />
            <ellipse cx="126" cy="128" rx={glow ? 8.5 : 7.5} ry={glow ? 5 : 4.5} fill={BLUSH} opacity={glow ? 1 : 0.9} />
            <Mouth mood={mood} f={f} />
            {(f <= 0.4 || mood === "wide") && (
              <path className="mascot__sweat" d="M134 92 Q140 102 134 106 Q128 102 134 92 Z" fill={SHINE} stroke={NAVY} strokeWidth="2" />
            )}
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

      {!gone && mood === "sleepy" && (
        <g className="mascot__zz" transform={`translate(${rightX - 162} ${topY - 48})`} fill="none" stroke="var(--accent)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
          <path className="mascot__z" d="M150 34 H158 L150 43 H158" />
          <path className="mascot__z mascot__z--2" d="M164 16 H175 L164 28 H175" />
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
