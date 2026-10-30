"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/** System preference by default; an explicit choice is stored under `firegrid-theme`. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="firegrid-theme">
      {children}
    </NextThemesProvider>
  );
}
