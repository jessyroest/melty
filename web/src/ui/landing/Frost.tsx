import { useEffect, useRef } from "react";
import { useReducedMotion } from "./hooks";

type Flake = { x: number; y: number; vx: number; vy: number; r: number; spin: number; a: number; kind: 0 | 1 };
type Spark = { x: number; y: number; vx: number; vy: number; r: number; spin: number; vs: number; life: number };

const SWIRL_R = 160;
const MAX_SPARKS = 72;

/** ask the nearest Frost canvas (the event target's) to burst crystals at a viewport point */
export function frostBurst(target: Element, x: number, y: number, count = 14): void {
  target.dispatchEvent(new CustomEvent("frost-burst", { detail: { x, y, count } }));
}

/**
 * Drifting ice crystals. Near the pointer they swirl and gather a little; with
 * `bursts`, a click or tap on the parent throws a handful of crystals outward.
 * Paused when off-screen or when the tab is hidden; a still frame when reduced
 * motion is requested.
 */
export function Frost({ density = 1, bursts = false }: { density?: number; bursts?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    const host = c?.parentElement;
    if (!c || !ctx || !host) return;

    let w = 0;
    let h = 0;
    let flakes: Flake[] = [];
    const sparks: Spark[] = [];
    let raf = 0;
    let visible = true;
    // the pointer, and how "awake" the swirl is (decays when the pointer rests)
    const pointer = { x: -9999, y: -9999, energy: 0 };
    const light = matchMedia("(prefers-color-scheme: light)");
    const color = () => getComputedStyle(c).getPropertyValue("--frost-flake").trim() || "rgba(200,240,255,0.8)";
    let fill = color();
    // the light token is a translucent teal on a pale page: lift it a bit
    let boost = light.matches ? 1.35 : 1;

    const spawn = (anywhere: boolean): Flake => ({
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : -10,
      vx: (Math.random() - 0.5) * 0.15,
      vy: 0.12 + Math.random() * 0.35,
      r: 1 + Math.random() * 2.6,
      spin: Math.random() * Math.PI,
      a: 0.25 + Math.random() * 0.6,
      kind: Math.random() < 0.3 ? 1 : 0,
    });

    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const r = c.getBoundingClientRect();
      if (r.width === w && r.height === h) return;
      w = r.width;
      h = r.height;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // keep the crystals we have (no flicker when a mobile toolbar slides), just top up or trim
      const n = Math.min(160, Math.round(((w * h) / 14000) * density));
      flakes = flakes.slice(0, n);
      for (const f of flakes) {
        if (f.x > w) f.x = Math.random() * w;
        if (f.y > h) f.y = Math.random() * h;
      }
      while (flakes.length < n) flakes.push(spawn(true));
      fill = color();
      draw();
    };

    const crystal = (x: number, y: number, r: number, spin: number) => {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const ang = spin + (i * Math.PI) / 3;
        const dx = Math.cos(ang) * r * 1.8;
        const dy = Math.sin(ang) * r * 1.8;
        ctx.moveTo(x - dx, y - dy);
        ctx.lineTo(x + dx, y + dy);
      }
      ctx.stroke();
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = fill;
      ctx.strokeStyle = fill;
      ctx.lineCap = "round";
      ctx.lineWidth = 0.9;
      for (const f of flakes) {
        ctx.globalAlpha = Math.min(1, f.a * boost);
        if (f.kind === 0) {
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r * 0.7, 0, Math.PI * 2);
          ctx.fill();
        } else {
          crystal(f.x, f.y, f.r, f.spin);
        }
      }
      ctx.lineWidth = 1.2;
      for (const s of sparks) {
        ctx.globalAlpha = Math.min(1, s.life * 1.4) * Math.min(1, 0.9 * boost);
        crystal(s.x, s.y, s.r, s.spin);
      }
      ctx.globalAlpha = 1;
    };

    const step = () => {
      raf = 0;
      const { x: px, y: py } = pointer;
      const e = pointer.energy;
      for (const f of flakes) {
        if (e > 0.02) {
          const dx = f.x - px;
          const dy = f.y - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < SWIRL_R * SWIRL_R) {
            const d = Math.sqrt(d2) || 1;
            const t = 1 - d / SWIRL_R;
            const nx = dx / d;
            const ny = dy / d;
            // orbit around the pointer, drawn in gently, but never onto it
            const swirl = t * 0.13 * e;
            const pull = d > 46 ? -t * 0.05 * e : (1 - d / 46) * 0.7;
            f.vx += -ny * swirl + nx * pull;
            f.vy += nx * swirl + ny * pull;
          }
        }
        f.vx *= 0.94;
        f.vy = f.vy * 0.94 + (0.12 + f.r * 0.06) * 0.06;
        f.x += f.vx + Math.sin((f.y + f.spin * 40) / 60) * 0.12;
        f.y += f.vy;
        f.spin += 0.004 + Math.abs(f.vx) * 0.004;
        if (f.y > h + 10 || f.y < -40 || f.x < -20 || f.x > w + 20) Object.assign(f, spawn(false));
      }
      pointer.energy *= 0.985;

      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]!;
        s.vx *= 0.93;
        s.vy = s.vy * 0.93 + 0.03;
        s.x += s.vx;
        s.y += s.vy;
        s.spin += s.vs;
        s.vs *= 0.96;
        s.life -= 0.012;
        if (s.life <= 0) sparks.splice(i, 1);
      }

      draw();
      if (visible && !document.hidden) raf = requestAnimationFrame(step);
    };

    const start = () => {
      if (!raf && !reduced) raf = requestAnimationFrame(step);
    };

    const burst = (cx: number, cy: number, count: number) => {
      if (reduced) return;
      const r = c.getBoundingClientRect();
      const x = cx - r.left;
      const y = cy - r.top;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + Math.random() * 0.5;
        const sp = 3 + Math.random() * 4.5;
        sparks.push({
          x,
          y,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp - 1,
          r: 1.6 + Math.random() * 2.4,
          spin: Math.random() * Math.PI,
          vs: (Math.random() - 0.5) * 0.3,
          life: 0.8 + Math.random() * 0.4,
        });
      }
      if (sparks.length > MAX_SPARKS) sparks.splice(0, sparks.length - MAX_SPARKS);
      // shove the crystals that were already there
      for (const f of flakes) {
        const dx = f.x - x;
        const dy = f.y - y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 180) {
          const k = (1 - d / 180) * 4;
          f.vx += (dx / d) * k;
          f.vy += (dy / d) * k;
        }
      }
      start();
    };

    resize();
    start();

    const onMove = (ev: PointerEvent) => {
      const r = c.getBoundingClientRect();
      pointer.x = ev.clientX - r.left;
      pointer.y = ev.clientY - r.top;
      pointer.energy = 1;
    };
    // fingers don't hover: forget the touch point once it lifts
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerType !== "mouse") pointer.energy = 0;
    };
    const onDown = (ev: PointerEvent) => burst(ev.clientX, ev.clientY, 12);
    const onBurst = (ev: Event) => {
      const d = (ev as CustomEvent<{ x: number; y: number; count?: number }>).detail;
      if (d) burst(d.x, d.y, d.count ?? 14);
    };
    const io = new IntersectionObserver(([en]) => {
      visible = !!en?.isIntersecting;
      if (visible) start();
    });
    io.observe(c);
    const onVis = () => !document.hidden && start();
    const onScheme = () => {
      fill = color();
      boost = light.matches ? 1.35 : 1;
      draw();
    };
    addEventListener("pointermove", onMove, { passive: true });
    addEventListener("pointerup", onUp, { passive: true });
    addEventListener("pointercancel", onUp, { passive: true });
    addEventListener("resize", resize);
    if (bursts) host.addEventListener("pointerdown", onDown, { passive: true });
    host.addEventListener("frost-burst", onBurst);
    document.addEventListener("visibilitychange", onVis);
    light.addEventListener("change", onScheme);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
      removeEventListener("pointercancel", onUp);
      removeEventListener("resize", resize);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("frost-burst", onBurst);
      document.removeEventListener("visibilitychange", onVis);
      light.removeEventListener("change", onScheme);
    };
  }, [density, bursts, reduced]);

  return <canvas ref={canvas} className="frost" aria-hidden="true" />;
}
