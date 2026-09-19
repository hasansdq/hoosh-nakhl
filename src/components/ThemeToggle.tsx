"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Animated light/dark theme toggle — sun waxes/wanes into a crescent moon.
 * Visible in the site header on every breakpoint (also inside mobile sheet).
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // avoid hydration mismatch — read theme only after mount
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(t);
  }, []);

  if (!mounted) {
    return <Button variant="ghost" size="icon" className={`rounded-xl ${className}`} aria-label="تغییر تم" />;
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={`relative overflow-hidden rounded-xl transition-colors hover:bg-accent ${className}`}
      aria-label={isDark ? "روشن کردن تم" : "تیره کردن تم"}
      title={isDark ? "حالت روشن" : "حالت تیره"}
    >
      <Sun
        className={`absolute h-5 w-5 transition-all duration-500 ${
          isDark ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
        } text-gold`}
      />
      <Moon
        className={`absolute h-5 w-5 transition-all duration-500 ${
          isDark ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0"
        } text-primary`}
      />
    </Button>
  );
}
