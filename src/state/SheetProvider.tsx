"use client";

import { createContext, useCallback, useEffect, useMemo, useState } from "react";

export type SheetName =
  | "confirm"
  | "account"
  | "intro"
  | "unlock"
  | "leave"
  | "paywall"
  | "switcher"
  | "part"
  | "delete";

export interface SheetEntry {
  name: SheetName;
  props: Record<string, unknown>;
}

export interface SheetContextValue {
  stack: SheetEntry[];
  top: SheetEntry | null;
  openSheet: (name: SheetName, props?: Record<string, unknown>) => void;
  closeSheet: () => void;
  /**
   * Pops the top sheet WITHOUT calling history.back(). Use this — paired
   * with router.replace(...), never router.push(...) — when a sheet action
   * also navigates to a different route in the same handler. closeSheet()'s
   * history.back() is asynchronous; a router.push() issued right after it
   * races the deferred back-navigation and gets reverted by it (the back
   * lands on whatever the history stack looks like once it actually runs,
   * which is after the push already moved the current position forward).
   * router.replace() sidesteps this by overwriting the dummy entry
   * openSheet() pushed instead of adding a new one to navigate past.
   */
  dismissForNavigation: () => void;
}

export const SheetContext = createContext<SheetContextValue | null>(null);

/**
 * Sheets are an overlay stack, not routes (spec §9.2). Opening one pushes a
 * dummy history entry so the browser/hardware back button and Escape both
 * close the top sheet instead of navigating away.
 */
export function SheetProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<SheetEntry[]>([]);

  const openSheet = useCallback((name: SheetName, props: Record<string, unknown> = {}) => {
    setStack((s) => [...s, { name, props }]);
    if (typeof window !== "undefined") {
      window.history.pushState(null, "", window.location.href);
    }
  }, []);

  // Closing (via UI button or Escape) goes through history.back() so the
  // dummy entry openSheet pushed is consumed the same way a hardware back
  // press would consume it — one code path, one source of truth.
  const closeSheet = useCallback(() => {
    if (typeof window !== "undefined") window.history.back();
    else setStack((s) => s.slice(0, -1));
  }, []);

  const dismissForNavigation = useCallback(() => {
    setStack((s) => s.slice(0, -1));
  }, []);

  useEffect(() => {
    function onPopState() {
      setStack((s) => (s.length ? s.slice(0, -1) : s));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && stack.length) {
        e.preventDefault();
        closeSheet();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [stack.length, closeSheet]);

  const value = useMemo<SheetContextValue>(
    () => ({ stack, top: stack[stack.length - 1] ?? null, openSheet, closeSheet, dismissForNavigation }),
    [stack, openSheet, closeSheet, dismissForNavigation]
  );

  return <SheetContext.Provider value={value}>{children}</SheetContext.Provider>;
}
