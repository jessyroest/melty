import type { CSSProperties, ReactNode } from "react";
import { Mascot, type Mood } from "../src/ui/Mascot";

/**
 * The melty promo: a 1920×1080 motion piece. Everything on screen is a pure
 * function of `t` (seconds), so every frame renders exactly the same each time.
 */
export const DURATION = 29;

// ---- timing helpers ----------------------------------------------------------

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
/** 0 before a, 1 after b, linear in between */
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeIn = (x: number) => x ** 3;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
/** a soft overshoot that settles at 1 */
const springy = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-6 * x) * Math.cos(9 * x));
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
/** deterministic noise in [0, 1) */
const rand = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** a scene's opacity: fades in at a, out at b */
const sceneOpacity = (t: number, a: number, b: number, fade = 0.35) =>
  Math.min(easeOut(seg(t, a, a + fade)), 1 - easeIn(seg(t, b - fade, b)));

const ACCENT = "#7fe7f2";
const MUTED = "#a3b3cc";

// ---- building blocks ---------------------------------------------------------

/** words that rise in one after another */
function Words({ text, at, t, stagger = 0.07, className, style }: { text: string; at: number; t: number; stagger?: number; className?: string; style?: CSSProperties }) {
  const words = text.split(" ");
  return (
    <div className={className} style={style}>
      {words.map((w, i) => {
        const p = easeOut(seg(t, at + i * stagger, at + i * stagger + 0.55));
        return (
          <span
            key={i}
            className="word"
            style={{ opacity: p, transform: `translateY(${(1 - p) * 0.45}em)`, filter: `blur(${(1 - p) * 8}px)` }}
          >
            {w}
            {i < words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </div>
  );
}

function Pill({ children, p, style, className }: { children: ReactNode; p: number; style?: CSSProperties; className?: string }) {
  return (
    <span
      className={`pill${className ? ` ${className}` : ""}`}
      style={{ opacity: clamp(p * 2), transform: `scale(${lerp(0.6, 1, springy(p))})`, ...style }}
    >
      {children}
    </span>
  );
}

function Snow({ t }: { t: number }) {
  const flakes = [];
  for (let i = 0; i < 110; i++) {
    const speed = 18 + rand(i + 2000) * 46;
    const y = ((rand(i + 1000) * 1240 + t * speed) % 1240) - 80;
    const x = rand(i) * 1920 + Math.sin(t * 0.6 + i) * 18;
    const r = 1 + rand(i + 3000) * 2.6;
    const a = 0.15 + rand(i + 4000) * 0.5;
    flakes.push(<circle key={i} cx={x} cy={y} r={r} fill="#d4f6ff" opacity={a} />);
  }
  return (
    <svg className="layer" viewBox="0 0 1920 1080" width="1920" height="1080">
      {flakes}
    </svg>
  );
}

/** a burst of ice crystals from (x, y), `age` seconds after it happened */
function Burst({ x, y, age, n = 18, reach = 240 }: { x: number; y: number; age: number; n?: number; reach?: number }) {
  if (age < 0 || age > 1.4) return null;
  const p = easeOut(clamp(age / 1.2));
  return (
    <svg className="layer" viewBox="0 0 1920 1080" width="1920" height="1080">
      {Array.from({ length: n }, (_, i) => {
        const ang = (i / n) * Math.PI * 2 + rand(i + 50) * 0.5;
        const d = reach * (0.5 + rand(i + 70) * 0.6) * p;
        const cx = x + Math.cos(ang) * d * 1.4;
        const cy = y + Math.sin(ang) * d * 0.55 - p * 40;
        const s = 3 + rand(i + 90) * 4;
        return (
          <g key={i} transform={`translate(${cx} ${cy}) rotate(${p * 160 + i * 20})`} opacity={1 - p} stroke="#e9fdff" strokeWidth="1.6" strokeLinecap="round">
            <path d={`M${-s} 0 H${s} M${-s / 2} ${-s * 0.87} L${s / 2} ${s * 0.87} M${-s / 2} ${s * 0.87} L${s / 2} ${-s * 0.87}`} />
          </g>
        );
      })}
    </svg>
  );
}

function Lock({ size = 34, color = "#0b1530" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function Key({ size = 34, color = "#0b1530" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7.5" cy="15.5" r="4" />
      <path d="M10.5 12.5l8-8M15.5 7.5l2.5 2.5M13.5 9.5l2 2" />
    </svg>
  );
}

const pad2 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, "0");
const clock = (s: number) => `${pad2(s / 60)}:${pad2(s % 60)}`;

// ---- scenes ------------------------------------------------------------------

/** 1. a cube drops in and says its name */
function Intro({ t }: { t: number }) {
  const o = sceneOpacity(t, -1, 3.7, 0.45);
  const fall = easeIn(seg(t, 0.05, 0.75));
  const d = seg(t, 0.75, 1.9);
  const sq = t > 0.75 ? Math.exp(-5 * d) * Math.cos(d * Math.PI * 3.2) * 0.24 : 0;
  const y = lerp(-760, 0, fall);
  const exit = easeIn(seg(t, 3.2, 3.7));
  const blink = (t > 2.45 && t < 2.58) || (t > 2.72 && t < 2.82);
  const letters = "melty".split("");
  return (
    <div className="scene" style={{ opacity: o, transform: `translateY(${-exit * 60}px)` }}>
      <div className="glow" style={{ left: 960, top: 470, opacity: easeOut(seg(t, 0.7, 1.6)) }} />
      <div style={{ position: "absolute", left: 960 - 170, top: 250, transform: `translateY(${y}px) scale(${1 + sq}, ${1 - sq})`, transformOrigin: "50% 88%" }}>
        <Mascot left={1} size={340} blink={blink} look={{ x: 0, y: t > 1.3 ? 0.5 : -0.6 }} mood={t > 0.75 && t < 1.25 ? "squint" : "happy"} />
      </div>
      <Burst x={960} y={548} age={t - 0.75} />
      <div className="wordmark" style={{ top: 640 }}>
        {letters.map((c, i) => {
          const p = springy(seg(t, 1.15 + i * 0.08, 1.95 + i * 0.08));
          return (
            <span key={i} style={{ display: "inline-block", opacity: clamp(p * 1.5), transform: `translateY(${(1 - p) * 70}px)` }}>
              {c}
            </span>
          );
        })}
      </div>
      <Words text="chat rooms that melt." at={2.0} t={t} className="tagline" style={{ top: 820 }} />
    </div>
  );
}

/** 2. open a room, pick a timer */
function OpenRoom({ t }: { t: number }) {
  const o = sceneOpacity(t, 3.6, 7.4);
  const ring = easeInOut(seg(t, 4.9, 5.7));
  const secs = 3600 - Math.max(0, t - 5.7) * 37;
  const picked = t > 4.6;
  const C = 2 * Math.PI * 200;
  return (
    <div className="scene" style={{ opacity: o }}>
      <div style={{ position: "absolute", left: 150, top: 330, width: 820 }}>
        <Words text="open a room." at={3.8} t={t} className="headline" />
        <Words text="no account. no sign-up. pick a timer." at={4.25} t={t} className="sub" style={{ marginTop: 28 }} stagger={0.05} />
        <div style={{ display: "flex", gap: 18, marginTop: 48 }}>
          {["10 min", "1 hour", "24 hours"].map((l, i) => (
            <Pill key={l} p={seg(t, 4.3 + i * 0.1, 4.9 + i * 0.1)} className={picked && i === 1 ? "pill--on" : ""}>
              {l}
            </Pill>
          ))}
        </div>
      </div>
      <div className="panel" style={{ left: 1030, top: 160, width: 760, height: 760, opacity: easeOut(seg(t, 3.9, 4.5)), transform: `translateY(${(1 - easeOut(seg(t, 3.9, 4.6))) * 40}px)` }}>
        <svg width="760" height="760" viewBox="0 0 760 760" style={{ position: "absolute", inset: 0 }}>
          <circle cx="380" cy="350" r="200" fill="none" stroke="rgba(170,225,255,0.14)" strokeWidth="14" />
          <circle
            cx="380"
            cy="350"
            r="200"
            fill="none"
            stroke={ACCENT}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - ring * (secs / 3600))}
            transform="rotate(-90 380 350)"
          />
        </svg>
        <div style={{ position: "absolute", left: 380 - 140, top: 350 - 160 }}>
          <Mascot left={secs / 3600} size={280} look={{ x: 0, y: -0.4 }} blink={t > 6.3 && t < 6.42} />
        </div>
        <div className="mono clock" style={{ opacity: ring }}>
          {clock(secs)}
        </div>
        <div className="mono caption" style={{ top: 690, opacity: ring }}>
          melts in
        </div>
      </div>
    </div>
  );
}

/** 3. share by link or 4 words */
function Share({ t }: { t: number }) {
  const o = sceneOpacity(t, 7.4, 11.4);
  const frag = "iqcMRSt4eAs5bCxqW2pLk0oZ8vYh3NfJdTr6GuE1yBa";
  const typed = Math.round(frag.length * seg(t, 8.0, 9.0));
  const caret = Math.floor(t * 2.5) % 2 === 0 && typed < frag.length;
  const words = ["hefty", "limb", "gift", "art"];
  return (
    <div className="scene" style={{ opacity: o }}>
      <div style={{ position: "absolute", left: 150, top: 170 }}>
        <Words text="share a link." at={7.6} t={t} className="headline" />
        <Words text="or say 4 words." at={9.25} t={t} className="headline accent" />
      </div>
      <div className="linkbar mono" style={{ left: 150, top: 560, fontSize: 34, opacity: easeOut(seg(t, 7.8, 8.2)), transform: `translateX(${(1 - easeOut(seg(t, 7.8, 8.3))) * -40}px)` }}>
        <span style={{ color: MUTED }}>melty/r</span>
        <span style={{ color: ACCENT }}>#{frag.slice(0, typed)}</span>
        {caret && <span className="caret" />}
      </div>
      <Words text="the part after # never reaches a server." at={9.0} t={t} className="note mono" style={{ left: 150, top: 670 }} stagger={0.04} />
      <div style={{ position: "absolute", left: 150, top: 790, display: "flex", gap: 24 }}>
        {words.map((w, i) => (
          <Pill key={w} p={seg(t, 9.6 + i * 0.13, 10.3 + i * 0.13)} className="pill--big mono">
            {w}
          </Pill>
        ))}
      </div>
      <div style={{ position: "absolute", left: 1480, top: 190, transform: `rotate(${Math.sin(t * 2) * 3}deg)`, opacity: easeOut(seg(t, 7.7, 8.3)) }}>
        <Mascot left={1} size={340} mood={t > 9.6 ? "squint" : "happy"} look={{ x: -0.8, y: 0.3 }} />
      </div>
    </div>
  );
}

const SAFETY = ["union", "bride", "curve", "keg", "crepe", "drill"];

/** 4. the key comes from someone inside, through a post-quantum exchange */
function KeyExchange({ t }: { t: number }) {
  const o = sceneOpacity(t, 11.4, 17.0);
  const travel = easeInOut(seg(t, 12.7, 14.1));
  const ax = 520;
  const bx = 1400;
  const cx = lerp(ax + 110, bx - 110, travel);
  const cy = 560 - Math.sin(travel * Math.PI) * 120;
  const arrived = t > 14.1;
  const hop = arrived ? Math.sin(seg(t, 14.1, 14.6) * Math.PI) * 40 : 0;
  const check = springy(seg(t, 15.7, 16.3));
  return (
    <div className="scene" style={{ opacity: o }}>
      <Words text="the key never rides along." at={11.6} t={t} className="headline center" style={{ top: 90 }} />
      <Words text="someone inside hands it over · X25519 + ML-KEM-768" at={12.1} t={t} className="sub center mono" style={{ top: 250 }} stagger={0.04} />
      <svg className="layer" viewBox="0 0 1920 1080" width="1920" height="1080">
        <path d={`M${ax + 110} 560 Q960 ${560 - 240} ${bx - 110} 560`} fill="none" stroke="rgba(127,231,242,0.35)" strokeWidth="3" strokeDasharray="10 14" strokeDashoffset={-t * 60} opacity={easeOut(seg(t, 12.3, 12.8))} />
      </svg>
      {[ax, bx].map((x, i) => (
        <div key={i} style={{ position: "absolute", left: x - 125, top: 440 - (i === 1 ? hop : 0), opacity: easeOut(seg(t, 11.9 + i * 0.15, 12.5 + i * 0.15)) }}>
          <Mascot left={1} size={250} mood={i === 1 ? (arrived ? "squint" : "wide") : "happy"} look={{ x: i === 0 ? 0.8 : -0.8, y: 0 }} />
          <div className="mono label">{i === 0 ? "inside" : "just joined"}</div>
        </div>
      ))}
      {travel > 0 && !arrived && (
        <div className="capsule" style={{ left: cx - 120, top: cy - 44 }}>
          <Lock size={30} />
          <Key size={30} />
          <span className="mono">sealed</span>
        </div>
      )}
      <Burst x={bx} y={500} age={t - 14.1} n={14} reach={160} />
      {[ax, bx].map((x, side) => (
        <div key={side} className="safety" style={{ left: x - 250, top: 790 }}>
          {SAFETY.map((w, i) => {
            const p = seg(t, 14.4 + i * 0.12 + side * 0.06, 14.9 + i * 0.12 + side * 0.06);
            return (
              <Pill key={w} p={p} className="mono pill--word">
                {w}
              </Pill>
            );
          })}
        </div>
      ))}
      <div className="verdict" style={{ opacity: clamp(check * 1.4), transform: `translateX(-50%) scale(${lerp(0.7, 1, check)})` }}>
        <span className="tick">✓</span> same 6 words on both sides · nobody in the middle
      </div>
    </div>
  );
}

const GLYPHS = "▓▒░█▚▞▙▟◆◇●○■□▲△⬡⬢※";
function noise(seed: number, len: number) {
  let s = "";
  for (let i = 0; i < len; i++) s += GLYPHS[Math.floor(rand(seed * 31 + i) * GLYPHS.length)];
  return s;
}

/** 5. the relay only ever sees noise */
function Relay({ t }: { t: number }) {
  const o = sceneOpacity(t, 17.0, 21.0);
  const msgs = [
    { text: "see you at 8?", at: 17.6, y: 520 },
    { text: "bring the good snacks", at: 18.25, y: 640 },
    { text: "this melts at midnight", at: 18.9, y: 760 },
  ];
  return (
    <div className="scene" style={{ opacity: o }}>
      <Words text="the relay sees noise." at={17.2} t={t} className="headline center" style={{ top: 90 }} />
      <Words text="sealed on your device · padded to fixed sizes · no messages stored" at={17.7} t={t} className="sub center mono" style={{ top: 250 }} stagger={0.03} />
      <div className="panel relay" style={{ left: 760, top: 400, width: 400, height: 480, opacity: easeOut(seg(t, 17.3, 17.8)) }}>
        <div className="mono relay__title">relay</div>
        <div className="mono relay__store">
          stores only
          <br />
          <span style={{ color: ACCENT }}>{"{ expiresAt }"}</span>
        </div>
      </div>
      {msgs.map((m, i) => {
        const p = seg(t, m.at, m.at + 2.3);
        if (p <= 0 || p >= 1) return null;
        const x = lerp(120, 1800, easeInOut(p));
        const sealed = x > 560 && x < 1360;
        const frame = Math.floor(t * 14);
        return (
          <div key={i} className={`bubble mono${sealed ? " bubble--sealed" : ""}`} style={{ left: x - 210, top: m.y }}>
            {sealed ? noise(frame + i * 100, 22) : m.text}
          </div>
        );
      })}
    </div>
  );
}

/** 6. the timer runs out and the room melts */
function Melt({ t }: { t: number }) {
  const o = sceneOpacity(t, 21.0, 25.0, 0.4);
  const secs = lerp(3, 0, seg(t, 21.3, 22.5));
  const left = 1 - easeInOut(seg(t, 22.5, 23.9));
  const mood: Mood = left > 0.6 ? "happy" : "squint";
  const steam = seg(t, 23.6, 24.9);
  const C = 2 * Math.PI * 250;
  return (
    <div className="scene" style={{ opacity: o }}>
      <svg className="layer" viewBox="0 0 1920 1080" width="1920" height="1080">
        <circle cx="960" cy="430" r="250" fill="none" stroke="rgba(170,225,255,0.12)" strokeWidth="12" />
        <circle cx="960" cy="430" r="250" fill="none" stroke={secs < 1.5 ? "#ffb27a" : ACCENT} strokeWidth="12" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - secs / 3) } transform="rotate(-90 960 430)" opacity={1 - seg(t, 22.4, 22.9)} />
      </svg>
      <div className="mono clock clock--big" style={{ opacity: 1 - seg(t, 22.4, 22.9) }}>
        {`00:0${Math.ceil(secs)}`}
      </div>
      <div style={{ position: "absolute", left: 960 - 200, top: 250 }}>
        <Mascot left={left} size={400} mood={mood} blink={t > 21.9 && t < 22.0} />
      </div>
      <svg className="layer" viewBox="0 0 1920 1080" width="1920" height="1080">
        {[0, 1, 2, 3, 4].map((i) => {
          const s = clamp(steam * 1.3 - i * 0.12);
          return (
            <path
              key={i}
              d={`M${900 + i * 30} 600 q-24 -40 0 -80 q24 -40 0 -80`}
              fill="none"
              stroke="rgba(220,240,255,0.55)"
              strokeWidth="8"
              strokeLinecap="round"
              opacity={Math.sin(s * Math.PI)}
              transform={`translate(0 ${-s * 140})`}
            />
          );
        })}
      </svg>
      <Words text="then it melts." at={22.7} t={t} className="headline center" style={{ top: 740 }} />
      <Words text="the relay forgets the room. every browser drops the key." at={23.3} t={t} className="sub center" style={{ top: 900 }} stagger={0.04} />
    </div>
  );
}

/** 7. end card */
function EndCard({ t }: { t: number }) {
  const o = easeOut(seg(t, 25.0, 25.5)) * (1 - easeIn(seg(t, DURATION - 0.6, DURATION)));
  const chips = ["end-to-end encrypted", "post-quantum key exchange", "no account"];
  const pop = springy(seg(t, 25.1, 25.9));
  return (
    <div className="scene" style={{ opacity: o }}>
      <div className="glow" style={{ left: 960, top: 420, opacity: 0.9 }} />
      <div style={{ position: "absolute", left: 960 - 330, top: 300, display: "flex", alignItems: "center", gap: 36 }}>
        <div style={{ transform: `scale(${lerp(0.4, 1, pop)}) rotate(${(1 - pop) * -20}deg)`, transformOrigin: "50% 88%" }}>
          <Mascot left={1} size={220} blink={t > 27.2 && t < 27.32} look={{ x: 0.3, y: 0 }} />
        </div>
        <div className="wordmark wordmark--inline" style={{ opacity: clamp(pop * 1.4), transform: `translateX(${(1 - pop) * -30}px)` }}>
          melty
        </div>
      </div>
      <Words text="chat rooms that melt." at={25.7} t={t} className="tagline" style={{ top: 600 }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 740, display: "flex", justifyContent: "center", gap: 20 }}>
        {chips.map((c, i) => (
          <Pill key={c} p={seg(t, 26.2 + i * 0.15, 26.9 + i * 0.15)} className="mono">
            {c}
          </Pill>
        ))}
      </div>
    </div>
  );
}

export function Promo({ t }: { t: number }) {
  // a slow drift of the whole backdrop keeps even the still moments alive
  const bg = `radial-gradient(1200px 800px at ${50 + Math.sin(t * 0.25) * 8}% ${40 + Math.cos(t * 0.2) * 6}%, rgba(63,211,230,0.16), transparent 60%), radial-gradient(900px 700px at 85% 90%, rgba(80,120,255,0.12), transparent 60%), linear-gradient(180deg, #0a1024 0%, #060a18 100%)`;
  return (
    <div className="stage" style={{ background: bg }}>
      <Snow t={t} />
      {t < 3.8 && <Intro t={t} />}
      {t >= 3.5 && t < 7.5 && <OpenRoom t={t} />}
      {t >= 7.3 && t < 11.5 && <Share t={t} />}
      {t >= 11.3 && t < 17.1 && <KeyExchange t={t} />}
      {t >= 16.9 && t < 21.1 && <Relay t={t} />}
      {t >= 20.9 && t < 25.1 && <Melt t={t} />}
      {t >= 24.9 && <EndCard t={t} />}
      <div className="vignette" />
    </div>
  );
}
