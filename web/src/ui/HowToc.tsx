import { useEffect, useState } from "react";

export type TocItem = { id: string; label: string };

/** which section is currently being read: the last one whose top passed 35% of the viewport */
function useActive(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      let current = ids[0] ?? "";
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top < innerHeight * 0.35) current = id;
      }
      setActive(current);
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
  }, [ids]);
  return active;
}

export function HowToc({ items }: { items: TocItem[] }) {
  const [ids] = useState(() => items.map((i) => i.id));
  const active = useActive(ids);
  return (
    <nav className="how-toc" aria-label="on this page">
      <p className="how-toc__title mono">on this page</p>
      <ol>
        {items.map((item, i) => (
          <li key={item.id}>
            <a href={`#${item.id}`} aria-current={active === item.id ? "location" : undefined}>
              <span className="how-toc__n mono" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
