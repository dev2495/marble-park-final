"use client";

import { ReactNode, useEffect, useRef, useState } from "react";

/**
 * Wide table wrapper for small screens: scrolls sideways, keeps the first column
 * and the header row in view, and shows a hint while there is more to the right.
 */
export function ScrollTable({
  children,
  className = "",
  maxHeight = "70vh",
  label = "Table",
}: {
  children: ReactNode;
  className?: string;
  maxHeight?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [moreRight, setMoreRight] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setMoreRight(node.scrollWidth - node.clientWidth - node.scrollLeft > 8);
    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(node);
    if (node.firstElementChild) observer?.observe(node.firstElementChild);
    return () => {
      node.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, []);

  return (
    <div className="relative">
      <div
        ref={ref}
        role="region"
        aria-label={label}
        tabIndex={0}
        style={{ maxHeight }}
        className={`overflow-auto [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-[2] [&_thead_th]:bg-[var(--bg-soft)] [&_tbody_td:first-child]:sticky [&_tbody_td:first-child]:left-0 [&_tbody_td:first-child]:z-[1] [&_tbody_td:first-child]:bg-[var(--surface)] [&_thead_th:first-child]:left-0 [&_thead_th:first-child]:z-[3] ${className}`}
      >
        {children}
      </div>
      {moreRight ? (
        <>
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-[var(--surface)] to-transparent lg:hidden" />
          <p className="pointer-events-none absolute bottom-2 right-3 rounded-full bg-[var(--ink)]/80 px-2.5 py-1 text-xs font-semibold text-white lg:hidden">
            Swipe sideways for more
          </p>
        </>
      ) : null}
    </div>
  );
}
