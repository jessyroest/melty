import { type CSSProperties, useEffect, useRef, useState } from "react";
import { useNoise, useReducedMotion } from "./landing/hooks";
import { Mascot } from "./Mascot";

/**
 * The data-flow diagram at the top of /how. Two drawings of the same thing:
 * horizontal for wide screens, vertical for phones (CSS picks one). All motion
 * is CSS, so reduced motion leaves a still, fully labelled frame.
 */

type Pt = [number, number];

function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOn(!!e?.isIntersecting), { rootMargin: "80px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, on] as const;
}

function Dots({ x, y }: { x: number; y: number }) {
  return (
    <g className="hd-dots">
      <circle cx={x} cy={y} r="3.5" />
      <circle cx={x + 11} cy={y} r="3.5" />
      <circle cx={x + 22} cy={y} r="3.5" />
    </g>
  );
}

function Lock({ x, y }: { x: number; y: number }) {
  return (
    <g className="hd-lock" transform={`translate(${x} ${y})`}>
      <path d="M3 7 V4.5 a4 4 0 0 1 8 0 V7" fill="none" strokeWidth="2" />
      <rect x="0" y="7" width="14" height="10" rx="3" />
    </g>
  );
}

function Key({ x, y }: { x: number; y: number }) {
  return (
    <g className="hd-key" transform={`translate(${x} ${y})`}>
      <circle cx="5" cy="6" r="4.2" fill="none" strokeWidth="2.2" />
      <path d="M9 6 H17 M14 6 V9.5 M16.5 6 V8.5" fill="none" strokeWidth="2.2" strokeLinecap="round" />
    </g>
  );
}

/** your browser: link secret → link → HKDF → room id + psk. 320 × 290 */
function You({ x, y, secret }: { x: number; y: number; secret: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect className="hd-box hd-box--you" width="320" height="290" rx="22" />
      <Dots x={20} y={22} />
      <text className="hd-label" x="58" y="26">
        your browser
      </text>

      <rect className="hd-chip" x="20" y="42" width="280" height="34" rx="10" />
      <text className="hd-t" x="34" y="64">
        <tspan className="hd-acc">link secret</tspan>
        <tspan className="hd-mut"> · 32 random bytes</tspan>
      </text>
      <path className="hd-arrow" d="M160 77 V93" />

      <rect className="hd-chip hd-chip--link" x="20" y="94" width="280" height="34" rx="10" />
      <text className="hd-t" x="34" y="116">
        <tspan className="hd-mut">link  /r</tspan>
        <tspan className="hd-acc">#{secret}</tspan>
      </text>
      <path className="hd-arrow" d="M160 129 V147" />

      <rect className="hd-kdf" x="90" y="148" width="140" height="30" rx="15" />
      <text className="hd-t hd-t--kdf" x="160" y="168" textAnchor="middle">
        HKDF-SHA256
      </text>
      <path className="hd-arrow" d="M128 179 L92 207" />
      <path className="hd-arrow" d="M192 179 L228 207" />

      <rect className="hd-out hd-out--id" x="20" y="208" width="135" height="62" rx="12" />
      <text className="hd-t hd-t--b" x="34" y="230">
        room id
      </text>
      <text className="hd-s" x="34" y="246">
        room-id-v1
      </text>
      <text className="hd-s hd-acc" x="34" y="261">
        → to the relay
      </text>

      <rect className="hd-out hd-out--key" x="165" y="208" width="135" height="62" rx="12" />
      <Lock x={276} y={217} />
      <text className="hd-t hd-t--b" x="179" y="230">
        link psk
      </text>
      <text className="hd-s" x="179" y="246">
        link-psk-v1
      </text>
      <text className="hd-s hd-acc" x="179" y="261">
        stays here
      </text>
    </g>
  );
}

/** the relay: forwards ciphertext, keeps the expiry time. 200 × 150 */
function Relay({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect className="hd-box hd-box--relay" width="200" height="150" rx="22" />
      <text className="hd-title" x="20" y="32">
        relay
      </text>
      <text className="hd-s" x="180" y="31" textAnchor="end">
        one per room
      </text>
      <text className="hd-s" x="20" y="54">
        forwards ciphertext,
      </text>
      <text className="hd-s" x="20" y="69">
        stores none of it
      </text>
      <rect className="hd-store" x="20" y="84" width="160" height="46" rx="11" />
      <text className="hd-s" x="34" y="103">
        stores only
      </text>
      <text className="hd-t hd-acc" x="34" y="121">
        {"{ expiresAt }"}
      </text>
    </g>
  );
}

/** someone who opened the link */
function Peer({ x, y, w, h, says }: { x: number; y: number; w: number; h: number; says: string }) {
  const narrow = w < 200;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect className="hd-box hd-box--peer" width={w} height={h} rx="18" />
      <Dots x={16} y={20} />
      <text className="hd-label" x="52" y="24">
        their browser
      </text>
      <Key x={16} y={narrow ? 38 : 42} />
      <text className="hd-s" x="40" y={narrow ? 48 : 52}>
        key via PQ exchange
      </text>
      <rect className="hd-bubble" x="14" y={h - 38} width={narrow ? w - 28 : 130} height="26" rx="13" />
      <text className="hd-t" x="26" y={h - 20}>
        {says}
      </text>
    </g>
  );
}

/** a sealed message travelling from a to b */
function Packet({ a, b, label, late }: { a: Pt; b: Pt; label: string; late?: boolean }) {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  // travel between the two edges, stopping short so the packet never sinks into a box
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const k = Math.max(0, len / 2 - 26) / len;
  const style = { "--dx": `${(b[0] - a[0]) * k}px`, "--dy": `${(b[1] - a[1]) * k}px` } as CSSProperties;
  return (
    <g className={`hd-packet${late ? " hd-packet--late" : ""}`} style={style}>
      <rect x={mx - 27} y={my - 11} width="54" height="22" rx="7" />
      <text x={mx} y={my + 4} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

/** the bottom strip: a timer that runs out, then everything melts */
function MeltRow({ x, y, w, compact }: { x: number; y: number; w: number; compact?: boolean }) {
  const bar = compact ? w : w - 250;
  return (
    <g transform={`translate(${x} ${y})`}>
      <text className="hd-label" x="0" y="0">
        expiresAt
      </text>
      <rect className="hd-timer" x="0" y="12" width={bar} height="10" rx="5" />
      <rect className="hd-timer__fill" x="0" y="12" width={bar} height="10" rx="5" />
      <g transform={compact ? `translate(0 38)` : `translate(${bar + 24} -30)`}>
        <svg x="0" y="0" width="54" height="54" viewBox="0 0 200 200" overflow="visible">
          <Mascot left={0.95} size={200} />
        </svg>
        <text className="hd-arrow-t" x="62" y="38">
          →
        </text>
        <svg x="80" y="0" width="54" height="54" viewBox="0 0 200 200" overflow="visible">
          <Mascot left={0.3} size={200} />
        </svg>
        <text className="hd-arrow-t" x="142" y="38">
          →
        </text>
        <svg x="160" y="0" width="54" height="54" viewBox="0 0 200 200" overflow="visible">
          <Mascot left={0} size={200} />
        </svg>
      </g>
      <text className="hd-s" x={compact ? 0 : bar + 24} y={compact ? 112 : 44}>
        at expiry it all melts:
      </text>
      <text className="hd-s hd-mut" x={compact ? 0 : bar + 24} y={compact ? 128 : 60}>
        room deleted, keys dropped
      </text>
    </g>
  );
}

function Wide({ secret }: { secret: string }) {
  return (
    <svg className="hd hd--wide" viewBox="0 0 1040 580" aria-hidden="true" focusable="false">
      <g className="hd-world">
        {/* the link travels outside the relay */}
        <path className="hd-share" d="M330 150 C 480 74, 660 74, 860 212" />
        <text className="hd-share-t" x="585" y="34" textAnchor="middle">
          you share the link yourself
        </text>
        <text className="hd-s" x="585" y="54" textAnchor="middle">
          the #secret part never reaches the relay
        </text>

        <You x={20} y={110} secret={secret} />

        {/* room id goes round the bottom */}
        <path className="hd-wire hd-wire--id" d="M107 380 V 452 H 550 V 424" />
        <text className="hd-s" x="330" y="444" textAnchor="middle">
          room id (not secret, reveals no key)
        </text>

        {/* ciphertext lanes */}
        <path className="hd-wire" d="M340 349 H 450" />
        <path className="hd-wire" d="M650 349 L 760 270" />
        <path className="hd-wire" d="M650 349 L 760 422" />
        <text className="hd-s" x="395" y="328" textAnchor="middle">
          {"{iv, ct}"}
        </text>

        <Relay x={450} y={274} />
        <Peer x={760} y={214} w={260} h={96} says="see you at 8?" />
        <Peer x={760} y={374} w={260} h={96} says="see you at 8?" />

        <Packet a={[340, 349]} b={[450, 349]} label="9f·Kq" />
        <Packet a={[650, 349]} b={[760, 270]} label="9f·Kq" late />
        <Packet a={[650, 349]} b={[760, 422]} label="9f·Kq" late />
      </g>
      <MeltRow x={40} y={510} w={980} />
      <text className="hd-melted" x="520" y="250" textAnchor="middle">
        melted.
      </text>
    </svg>
  );
}

function Tall({ secret }: { secret: string }) {
  return (
    <svg className="hd hd--tall" viewBox="-18 0 376 990" aria-hidden="true" focusable="false">
      <g className="hd-world">
        <You x={20} y={40} secret={secret} />

        {/* the link travels outside the relay */}
        <path className="hd-share" d="M20 110 C -14 260, -14 560, 26 700" />
        <text className="hd-share-t" transform="translate(-4 420) rotate(-90)" textAnchor="middle">
          you share the link yourself
        </text>

        <path className="hd-wire hd-wire--id" d="M107 330 V 430" />
        <text className="hd-s" x="116" y="352">
          room id
        </text>
        <path className="hd-wire" d="M252 330 V 430" />
        <text className="hd-s" x="243" y="352" textAnchor="end">
          {"{iv, ct}"}
        </text>

        <Relay x={80} y={430} />

        <path className="hd-wire" d="M180 580 L 98 680" />
        <path className="hd-wire" d="M180 580 L 262 680" />
        <Peer x={20} y={680} w={155} h={104} says="see you at 8?" />
        <Peer x={185} y={680} w={155} h={104} says="see you at 8?" />

        <Packet a={[252, 334]} b={[252, 428]} label="9f·Kq" />
        <Packet a={[180, 582]} b={[98, 678]} label="9f·Kq" late />
        <Packet a={[180, 582]} b={[262, 678]} label="9f·Kq" late />
      </g>
      <MeltRow x={20} y={838} w={320} compact />
      <text className="hd-melted" x="180" y="520" textAnchor="middle">
        melted.
      </text>
    </svg>
  );
}

export function HowDiagram() {
  const [ref, onScreen] = useOnScreen<HTMLDivElement>();
  const reduced = useReducedMotion();
  const secret = useNoise(9, 2400, reduced || !onScreen);
  return (
    <div ref={ref} className={`hd-wrap${onScreen ? "" : " is-paused"}`}>
      <Wide secret={`${secret}…`} />
      <Tall secret={`${secret}…`} />
    </div>
  );
}
