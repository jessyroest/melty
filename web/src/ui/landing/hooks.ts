import { type RefObject, useEffect, useState } from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** true once the element has scrolled into view (stays true) */
export function useInView(ref: RefObject<Element | null>, threshold = 0.25): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen, threshold]);
  return seen;
}

/** 0 when the element's top reaches the top of the viewport, 1 when its bottom reaches the bottom */
export function useScrollProgress(ref: RefObject<HTMLElement | null>): number {
  const [p, setP] = useState(0);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const span = r.height - innerHeight;
      setP(span <= 0 ? 0 : Math.min(1, Math.max(0, -r.top / span)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [ref]);
  return p;
}

/** a ticking string of random base64url-ish noise */
export function useNoise(length: number, everyMs: number, paused = false): string {
  const [s, setS] = useState(() => noise(length));
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setS(noise(length)), everyMs);
    return () => clearInterval(id);
  }, [length, everyMs, paused]);
  return s;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function noise(n: number): string {
  const r = crypto.getRandomValues(new Uint8Array(n));
  let s = "";
  for (const b of r) s += ALPHABET[b & 63];
  return s;
}
