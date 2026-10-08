import { useEffect, useRef, useState } from "react";
import { Mascot, type Mood } from "./Mascot";

const LINES = [
  "brr.",
  "cold hands, warm heart.",
  "say it before i melt.",
  "i forget everything. on purpose.",
  "don't leave me in the sun.",
  "careful, i'm mostly water.",
  "nothing to see here. literally.",
  "poke me again and i'll drip on you.",
];

type Props = {
  left?: number;
  size?: number;
  className?: string;
  /** clickable: squish + a line of dialogue */
  pokeable?: boolean;
  /** change this value to make the cube hop once */
  bump?: unknown;
};

/** The mascot, alive: eyes follow the pointer, it blinks, hops and can be poked. */
export function LiveMascot({ left = 1, size = 120, className, pokeable = false, bump }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);
  const [mood, setMood] = useState<Mood>("happy");
  const [line, setLine] = useState<string | null>(null);
  const [anim, setAnim] = useState<"" | "squish" | "hop">("");
  const lineIdx = useRef(Math.floor(Math.random() * LINES.length));

  // eyes follow the pointer
  useEffect(() => {
    let frame = 0;
    let target = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height * 0.55);
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, d / 220);
      target = { x: (dx / d) * reach, y: (dy / d) * reach };
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          setLook(target);
        });
      }
    };
    const onLeave = () => setLook({ x: 0, y: 0 });
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(frame);
    };
  }, []);

  // blink every few seconds, sometimes twice
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t = setTimeout(
        () => {
          setBlink(true);
          setTimeout(() => setBlink(false), 130);
          if (Math.random() < 0.25) {
            setTimeout(() => setBlink(true), 260);
            setTimeout(() => setBlink(false), 390);
          }
          schedule();
        },
        2200 + Math.random() * 4000,
      );
    };
    schedule();
    return () => clearTimeout(t);
  }, []);

  // hop when `bump` changes (skip the first render)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setAnim("hop");
    const t = setTimeout(() => setAnim(""), 520);
    return () => clearTimeout(t);
  }, [bump]);

  useEffect(() => {
    if (!line) return;
    const t = setTimeout(() => setLine(null), 2400);
    return () => clearTimeout(t);
  }, [line]);

  function poke() {
    lineIdx.current = (lineIdx.current + 1 + Math.floor(Math.random() * 3)) % LINES.length;
    setLine(LINES[lineIdx.current]!);
    setMood("surprised");
    setAnim("squish");
    setTimeout(() => setMood("happy"), 600);
    setTimeout(() => setAnim(""), 600);
  }

  const body = (
    <span ref={ref} className={`live-mascot${anim ? ` live-mascot--${anim}` : ""}`}>
      <Mascot left={left} size={size} look={look} blink={blink} mood={mood} />
    </span>
  );

  if (!pokeable) return <span className={className}>{body}</span>;
  return (
    <span className={`poke ${className ?? ""}`}>
      <button type="button" className="poke__btn" onClick={poke} aria-label="poke the ice cube">
        {body}
      </button>
      <span className={`poke__bubble${line ? " is-on" : ""}`} role="status">
        {line ?? ""}
      </span>
    </span>
  );
}
