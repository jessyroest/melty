import { type MouseEvent, type RefObject, useEffect, useRef } from "react";

/**
 * Shared behaviour for the room's modal sheets: open as a modal once (safe
 * under StrictMode), focus a chosen element, close on a backdrop click.
 */
export function useSheet(onClose: () => void, initialFocus?: RefObject<HTMLElement | null>) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d || d.open) return;
    d.showModal();
    initialFocus?.current?.focus();
  }, []); // open exactly once

  function onClick(e: MouseEvent<HTMLDialogElement>) {
    const d = ref.current;
    if (!d || e.target !== d) return;
    const r = d.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!inside) onClose();
  }

  return { ref, onClick };
}
