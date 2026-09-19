"use client";

import { ThemeProvider } from "next-themes";
import { DirectionProvider } from "@radix-ui/react-direction";

/**
 * App-wide providers (client boundary):
 * - Radix DirectionProvider → all Radix primitives (slider, menus, roving focus…) become RTL-aware
 * - next-themes ThemeProvider → light/dark class strategy, system-aware, with toggle in header
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <DirectionProvider dir="rtl">
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
        {children}
      </ThemeProvider>
    </DirectionProvider>
  );
}
