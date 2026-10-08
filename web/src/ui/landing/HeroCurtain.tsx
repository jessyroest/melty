import { type CSSProperties, useEffect, useId, useState } from "react";

type Drip = { x: number; w: number; l: number; s: number; d: number };

/** the strip of water that clings to the top edge for a moment */
const BAND = 14;

/** a little deterministic noise so the drips don't jump between renders */
function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** one drop hanging from y=0: soft shoulders, a thin neck, a round bulb at y=l */
function dripPath({ w, l }: Drip): string {
  const n = w * 0.24;
  const b = w * 0.5;
  const s = w * 1.4;
  const c = l - b; // bulb centre
  return (
    `M${-s} -1 C${-w * 0.5} 0 ${-n} ${l * 0.16} ${-n} ${c - b * 1.1} ` +
    `C${-n} ${c - b * 0.45} ${-b} ${c - b * 0.55} ${-b} ${c} ` +
    `A${b} ${b} 0 0 0 ${b} ${c} ` +
    `C${b} ${c - b * 0.55} ${n} ${c - b * 0.45} ${n} ${c - b * 1.1} ` +
    `C${n} ${l * 0.16} ${w * 0.5} 0 ${s} -1 Z`
  );
}

/** a gently lumpy horizontal edge at y≈0, left to right */
function wave(width: number, seed: number, amp: number): string {
  const step = 52;
  let d = "";
  for (let x = -20, i = 0; x < width + 20; x += step, i++) {
    d += ` Q${x + step / 2} ${-(rand(i + seed) * amp)} ${x + step} 0`;
  }
  return d;
}

function makeDrips(width: number, height: number): Drip[] {
  const count = Math.max(7, Math.round(width / 58));
  const gap = width / count;
  return Array.from({ length: count }, (_, i) => {
    const r = rand(i + 3);
    const w = 11 + rand(i) * 26 + r * 10;
    return {
      x: gap * (i + 0.5) + (rand(i + 7) - 0.5) * gap * 0.7,
      w,
      l: Math.max(w * 2.4, height * (0.07 + r * 0.3)),
      s: 1.15 + rand(i + 11) * 0.35,
      d: rand(i + 5) * 260,
    };
  });
}

/**
 * The screen drips away when you arrive here because your room melted: the page
 * is under meltwater, the water slides off, and what clings to the top edge hangs
 * in drops for a moment before it lets go too. Hidden under reduced motion.
 */
export function MeltCurtain() {
  const [on, setOn] = useState(true);
  const id = `${useId().replace(/[^a-zA-Z0-9]/g, "")}g`;
  const [geo] = useState(() => {
    const width = Math.max(320, innerWidth);
    const height = Math.max(320, innerHeight);
    const drips = makeDrips(width, height);
    const longest = Math.max(...drips.map((d) => d.l * d.s));
    return {
      width,
      height,
      drips,
      body: `M-20 ${height + 40} L-20 0${wave(width, 40, 14)} L${width + 40} ${height + 40} Z`,
      rim: `M-20 0${wave(width, 40, 14)}`,
      bodyFall: height + 40,
      bandFall: height + longest + BAND + 40,
    };
  });

  useEffect(() => {
    const t = setTimeout(() => setOn(false), 2600);
    return () => clearTimeout(t);
  }, []);
  if (!on) return null;

  const { width, height, drips, body, rim, bodyFall, bandFall } = geo;
  const fill = `url(#${id})`;
  return (
    <div className="curtain" aria-hidden="true">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={height}>
            <stop className="curtain__stop-a" offset="0" />
            <stop className="curtain__stop-b" offset="1" />
          </linearGradient>
        </defs>

        {/* what clings to the top, and the drops hanging off it */}
        <g className="curtain__band" style={{ ["--fall" as string]: `${bandFall}px` } as CSSProperties}>
          <rect x="-20" y="-40" width={width + 40} height={BAND + 40} fill={fill} />
          {drips.map((d, i) => (
            <g key={i} transform={`translate(${d.x.toFixed(1)} ${BAND - 1})`}>
              <g className="curtain__drip" style={{ ["--s" as string]: d.s, animationDelay: `${d.d}ms` } as CSSProperties}>
                <path d={dripPath(d)} fill={fill} />
                <ellipse className="curtain__shine" cx={-d.w * 0.16} cy={d.l - d.w * 0.62} rx={d.w * 0.1} ry={d.w * 0.17} />
              </g>
            </g>
          ))}
        </g>

        {/* the sheet of water sliding off the page */}
        <g className="curtain__body" style={{ ["--fall" as string]: `${bodyFall}px` } as CSSProperties}>
          <path d={body} fill={fill} />
          <path className="curtain__rim" d={rim} />
        </g>
      </svg>
    </div>
  );
}
