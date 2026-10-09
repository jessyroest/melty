import { type RefObject, useEffect, useRef, useState } from "react";

const SWIPE_CLOSE_PX = 90;

/**
 * Shared behaviour for the room's modal sheets: open as a modal once (safe
 * under StrictMode), focus a chosen element, close on a backdrop click, and on
 * phones (where they are bottom sheets) close on a swipe down.
 */
export function useSheet(onClose: () => void, initialFocus?: RefObject<HTMLElement | null>) {
  const ref = useRef<HTMLDialogElement>(null);
  // what to focus when the sheet opens; read once, at open
  const [focusTarget] = useState(initialFocus);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    d.showModal();
    focusTarget?.current?.focus();
  }, [focusTarget]); // focusTarget never changes: this opens exactly once

  // swipe down to dismiss, only while the sheet is scrolled to its top
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const phone = matchMedia("(max-width: 559px)");
    let y0 = Number.NaN;
    let dy = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;

    const start = (e: TouchEvent) => {
      const t = e.target as Element;
      if (!phone.matches || e.touches.length !== 1 || d.scrollTop > 0) return;
      if (t.closest("input, textarea, select")) return;
      y0 = e.touches[0]!.clientY;
      dy = 0;
    };
    const move = (e: TouchEvent) => {
      if (Number.isNaN(y0)) return;
      dy = Math.max(0, e.touches[0]!.clientY - y0);
      if (dy > 4 && d.scrollTop <= 0) {
        e.preventDefault(); // no pull-to-refresh or page bounce behind the sheet
        d.classList.add("is-dragging");
        d.style.transform = `translateY(${dy}px)`;
      }
    };
    const end = () => {
      if (Number.isNaN(y0)) return;
      y0 = Number.NaN;
      d.classList.remove("is-dragging");
      if (dy > SWIPE_CLOSE_PX) {
        close.current();
        return;
      }
      d.classList.add("is-settling");
      d.style.transform = "";
      clearTimeout(settle);
      settle = setTimeout(() => d.classList.remove("is-settling"), 240);
    };

    d.addEventListener("touchstart", start, { passive: true });
    d.addEventListener("touchmove", move, { passive: false });
    d.addEventListener("touchend", end);
    d.addEventListener("touchcancel", end);
    return () => {
      clearTimeout(settle);
      d.removeEventListener("touchstart", start);
      d.removeEventListener("touchmove", move);
      d.removeEventListener("touchend", end);
      d.removeEventListener("touchcancel", end);
    };
  }, []);

  // a click on the backdrop closes the sheet (keyboards close the native <dialog> with Escape)
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const click = (e: MouseEvent) => {
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) close.current();
    };
    d.addEventListener("click", click);
    return () => d.removeEventListener("click", click);
  }, []);

  return { ref };
}
