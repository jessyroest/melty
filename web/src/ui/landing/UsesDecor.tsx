// ---- decoration for the flood section: frozen crust on top, drips at the bottom, frost ferns ----

/** tiny deterministic random so the shapes are the same on every render */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const W = 1440;

/** jagged ice crystals along the top edge */
function crust(): string {
  const r = rng(7);
  let d = `M0 40 L0 30`;
  for (let x = 0; x < W; ) {
    const step = 14 + r() * 26;
    const peak = 30 - (6 + r() * (r() < 0.2 ? 26 : 14));
    d += ` L${(x + step * (0.35 + r() * 0.3)).toFixed(1)} ${peak.toFixed(1)} L${Math.min(W, x + step).toFixed(1)} ${(28 + r() * 4).toFixed(1)}`;
    x += step;
  }
  return `${d} L${W} 40 Z`;
}

/** [x, width, length] for the drips that hang off the bottom edge */
const DRIPS: [number, number, number][] = [
  [64, 26, 44],
  [168, 16, 22],
  [262, 34, 78],
  [398, 20, 30],
  [520, 28, 56],
  [612, 14, 18],
  [736, 38, 96],
  [884, 22, 34],
  [992, 30, 64],
  [1118, 18, 24],
  [1218, 34, 82],
  [1352, 22, 42],
];
const LIVE = new Set([2, 6, 10, 4]);

function drip(x: number, w: number, L: number): string {
  const r = w / 2;
  return (
    `M${x - w} 0 C${x - r} 0 ${x - r} ${r} ${x - r} ${w} L${x - r} ${L - r} ` +
    `A${r} ${r} 0 0 0 ${x + r} ${L - r} L${x + r} ${w} C${x + r} ${r} ${x + r} 0 ${x + w} 0 Z`
  );
}

function band(): string {
  let d = `M0 -2 L${W} -2 L${W} 8`;
  for (let x = W, k = 0; x > 0; x -= 120, k++) d += ` Q${x - 60} ${k % 2 ? 2 : 16} ${x - 120} 8`;
  return `${d} Z`;
}

const CRUST = crust();
const BAND = band();

export function UsesEdge({ side }: { side: "top" | "bottom" }) {
  if (side === "top") {
    return (
      <svg className="l-uses__edge l-uses__edge--top" viewBox={`0 0 ${W} 40`} preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <path d={CRUST} />
      </svg>
    );
  }
  return (
    <svg className="l-uses__edge l-uses__edge--bottom" viewBox={`0 0 ${W} 170`} preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      <path d={BAND} />
      {DRIPS.map(([x, w, L], i) => (
        <g key={x} className={LIVE.has(i) ? "l-uses__drip is-live" : "l-uses__drip"} style={{ ["--d" as string]: `${(i * 0.83) % 4}s` }}>
          <path d={drip(x, w, L + 6)} />
          <circle cx={x} cy={L + 6 - w / 2} r={w * 0.56} />
          {LIVE.has(i) && <circle className="l-uses__fall" cx={x} cy={L + 6 + w * 0.3} r={w * 0.32} />}
        </g>
      ))}
    </svg>
  );
}

/** one ice fern, split by depth so the trunk can grow before the twigs */
function fern(x: number, y: number, a: number, len: number): string[] {
  const out = ["", "", ""];
  const grow = (x0: number, y0: number, ang: number, l: number, depth: number) => {
    const x1 = x0 + Math.cos(ang) * l;
    const y1 = y0 + Math.sin(ang) * l;
    out[2 - depth] += `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}`;
    if (!depth) return;
    for (let k = 1; k <= 4; k++) {
      const t = k / 5;
      const bx = x0 + Math.cos(ang) * l * t;
      const by = y0 + Math.sin(ang) * l * t;
      const sub = l * (0.4 * (1 - t) + 0.1);
      grow(bx, by, ang + Math.PI / 3, sub, depth - 1);
      grow(bx, by, ang - Math.PI / 3, sub, depth - 1);
    }
  };
  grow(x, y, a, len, 2);
  return out;
}

const FERNS = [
  ...[0.25, 0.75, 1.2].map((a, i) => fern(0, 0, a, 230 - i * 40)),
];

export function UsesFrost({ seen }: { seen: boolean }) {
  return (
    <div className={`l-uses__frost${seen ? " is-in" : ""}`} aria-hidden="true">
      <svg className="l-uses__grain" width="100%" height="100%">
        <filter id="l-uses-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="4" />
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  3.2 0 0 0 -1.85" />
        </filter>
        <rect width="100%" height="100%" filter="url(#l-uses-grain)" />
      </svg>
      {["tl", "br"].map((c) => (
        <svg key={c} className={`l-uses__fern l-uses__fern--${c}`} viewBox="0 0 300 300">
          {FERNS.map((levels, i) =>
            levels.map((d, lv) => (
              <path key={`${i}-${lv}`} d={d} pathLength={1} style={{ ["--lv" as string]: lv, ["--f" as string]: i }} />
            )),
          )}
        </svg>
      ))}
    </div>
  );
}
