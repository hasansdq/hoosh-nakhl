"use client";

import { useState, useEffect } from "react";
import { ArrowUp } from "lucide-react";

/** Floating back-to-top button — appears after scrolling, smooth scroll to top */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let active = true;
    const onScroll = () => {
      if (!active) return;
      setVisible(window.scrollY > 600);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      active = false;
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="بازگشت به بالای صفحه"
      className="animate-fade-up fixed bottom-28 left-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-primary/20 bg-card text-primary shadow-lg shadow-primary/20 transition-all hover:-translate-y-1 hover:bg-primary hover:text-primary-foreground focus-visible:outline-none sm:bottom-5 sm:left-5"
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  );
}
