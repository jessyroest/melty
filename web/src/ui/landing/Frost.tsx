import { useEffect, useRef } from "react";
import { useReducedMotion } from "./hooks";

type Flake = { x: number; y: number; vx: number; vy: number; r: number; spin: number; a: number; kind: 0 | 1 };

/**
 * Drifting ice crystals behind the hero. They fall slowly and get pushed away
 * from the pointer. Paused when off-screen or when the tab is hidden; a still
 * frame when reduced motion is requested.
 */
export function Frost({ density = 1 }: { density?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;

    let w = 0;
    let h = 0;
    let flakes: Flake[] = [];
    let raf = 0;
    let visible = true;
    const pointer = { x: -9999, y: -9999 };
    const color = () => getComputedStyle(c).getPropertyValue("--frost-flake").trim() || "rgba(200,240,255,0.8)";
    let fill = color();

    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      const r = c.getBoundingClientRect();
      w = r.width;
      h = r.height;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(((w * h) / 14000) * density);
      flakes = Array.from({ length: n }, () => spawn(true));
      fill = color();
    };

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

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = fill;
      ctx.strokeStyle = fill;
      for (const f of flakes) {
        ctx.globalAlpha = f.a;
        if (f.kind === 0) {
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r * 0.7, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // a tiny six-armed crystal
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          for (let i = 0; i < 3; i++) {
            const ang = f.spin + (i * Math.PI) / 3;
            const dx = Math.cos(ang) * f.r * 1.8;
            const dy = Math.sin(ang) * f.r * 1.8;
            ctx.moveTo(f.x - dx, f.y - dy);
            ctx.lineTo(f.x + dx, f.y + dy);
          }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };

    const step = () => {
      raf = 0;
      for (const f of flakes) {
        const dx = f.x - pointer.x;
        const dy = f.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 120 * 120) {
          const d = Math.sqrt(d2) || 1;
          const push = (1 - d / 120) * 0.9;
          f.vx += (dx / d) * push;
          f.vy += (dy / d) * push;
        }
        f.vx *= 0.94;
        f.vy = f.vy * 0.94 + (0.12 + f.r * 0.06) * 0.06;
        f.x += f.vx + Math.sin((f.y + f.spin * 40) / 60) * 0.12;
        f.y += f.vy;
        f.spin += 0.004;
        if (f.y > h + 10 || f.x < -20 || f.x > w + 20) Object.assign(f, spawn(false));
      }
      draw();
      if (visible && !document.hidden) raf = requestAnimationFrame(step);
    };

    const start = () => {
      if (!raf && !reduced) raf = requestAnimationFrame(step);
    };

    resize();
    draw();
    start();

    const onMove = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
    };
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) start();
    });
    io.observe(c);
    const onVis = () => !document.hidden && start();
    const scheme = matchMedia("(prefers-color-scheme: light)");
    const onScheme = () => {
      fill = color();
      draw();
    };
    addEventListener("pointermove", onMove, { passive: true });
    addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVis);
    scheme.addEventListener("change", onScheme);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      removeEventListener("pointermove", onMove);
      removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVis);
      scheme.removeEventListener("change", onScheme);
    };
  }, [density, reduced]);

  return <canvas ref={canvas} className="frost" aria-hidden="true" />;
}
