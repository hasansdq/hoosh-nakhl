"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Scroll-reveal wrapper — fades content up when it enters the viewport.
 * Respects prefers-reduced-motion (content shows immediately, no transform).
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  /** stagger delay in ms */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cleanup: (() => void) | undefined;
    // reduced motion or very old browsers → show instantly (async to satisfy lint rule)
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      const t = window.setTimeout(() => setVisible(true), 0);
      cleanup = () => window.clearTimeout(t);
    } else {
      const obs = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            setVisible(true);
            obs.disconnect();
          }
        },
        { threshold: 0.12, rootMargin: "0px 0px -36px 0px" }
      );
      obs.observe(el);
      cleanup = () => obs.disconnect();
    }
    return cleanup;
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal ${visible ? "reveal-visible" : ""} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
