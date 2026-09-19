"use client";

import { createContext, useEffect, useMemo, useReducer, useRef } from "react";
import type { AllyState } from "@/state/schema";
import { allyReducer, type AllyAction } from "@/state/allyReducer";
import { migrate, STATE_KEY, type StorageLike } from "@/lib/migrate";
import { now } from "@/lib/clock";

export interface AllyContextValue {
  state: AllyState;
  dispatch: React.Dispatch<AllyAction>;
}

export const AllyContext = createContext<AllyContextValue | null>(null);

function safeStorage(): StorageLike {
  try {
    // touch localStorage to confirm it's usable (private mode can throw)
    window.localStorage.setItem("__ally_probe__", "1");
    window.localStorage.removeItem("__ally_probe__");
    return window.localStorage;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
    };
  }
}

export function AllyProvider({ children }: { children: React.ReactNode }) {
  const storageRef = useRef<StorageLike | null>(null);
  if (typeof window !== "undefined" && !storageRef.current) {
    storageRef.current = safeStorage();
  }

  const initial = useMemo<AllyState>(() => {
    if (typeof window === "undefined") {
      // SSR-safe placeholder; the real state hydrates on mount.
      return migrate(
        {
          getItem: () => null,
          setItem: () => {},
        },
        0
      );
    }
    return migrate(storageRef.current as StorageLike, now());
  }, []);

  const [state, dispatch] = useReducer(allyReducer, initial);

  // Persist on every change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      storageRef.current?.setItem(STATE_KEY, JSON.stringify({ ...state, savedAt: now() }));
    } catch {
      // storage full or blocked; the flow continues in memory
    }
  }, [state]);

  // Purge parted companions past their purge date on every mount / state change.
  useEffect(() => {
    dispatch({ type: "PURGE_PARTED", now: now() });
  }, []);

  const value = useMemo(() => ({ state, dispatch }), [state]);

  return <AllyContext.Provider value={value}>{children}</AllyContext.Provider>;
}
