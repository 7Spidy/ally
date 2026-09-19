"use client";

import { createContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AllyState } from "@/state/schema";
import { allyReducer, type AllyAction } from "@/state/allyReducer";
import { migrate, STATE_KEY, type StorageLike } from "@/lib/migrate";
import { now } from "@/lib/clock";

export interface AllyContextValue {
  state: AllyState;
  dispatch: React.Dispatch<AllyAction>;
  /**
   * False until the post-mount hydration effect has replaced the SSR-safe
   * placeholder with the real migrated state. React fires a descendant's
   * effects before its ancestors', so a page's own mount effect (e.g.
   * app/page.tsx's boot decision) can otherwise run BEFORE this provider's
   * hydration effect and read the placeholder as if it were real — always
   * a fresh, companion-less state. Anything that makes a one-shot decision
   * from `state` on mount must gate on `ready` first.
   */
  ready: boolean;
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

const EMPTY_STORAGE: StorageLike = { getItem: () => null, setItem: () => {} };

export function AllyProvider({ children }: { children: React.ReactNode }) {
  const storageRef = useRef<StorageLike | null>(null);

  // The initial render MUST be identical on the server and on the client's
  // first (pre-hydration) pass, or React throws a hydration mismatch.
  // migrate() against real localStorage is only safe to run once mounted —
  // reading it here (even gated on `typeof window`) diverges from the
  // server's placeholder the moment the client renders for the first time,
  // since `typeof window !== 'undefined'` is already true by then. So the
  // initial state is always the same deterministic placeholder; the real
  // migrated state is read in the effect below and applied via HYDRATE,
  // strictly after mount.
  const initial = useMemo<AllyState>(() => migrate(EMPTY_STORAGE, 0), []);

  const [state, dispatch] = useReducer(allyReducer, initial);
  const [ready, setReady] = useState(false);

  // Post-mount only: read the real migrated state from localStorage and
  // apply it, then purge any parted companions past their purge date — in
  // that order, both against the real state, in one effect so there's no
  // cross-effect timing to get wrong (see the persist effect below for why
  // that matters). Flips `ready` last, so anything gating on it (e.g.
  // BootPage) sees the fully hydrated+purged state on its first read.
  useEffect(() => {
    storageRef.current = safeStorage();
    const nowMs = now();
    dispatch({ type: "HYDRATE", state: migrate(storageRef.current, nowMs) });
    dispatch({ type: "PURGE_PARTED", now: nowMs });
    setReady(true);
  }, []);

  // Persist on every change, except the render(s) still holding the
  // pre-hydration placeholder. A local "have I run before" flag — not a
  // flag shared with the hydration effect above — is what's reliable here:
  // effects in the same commit run in declaration order, but a ref another
  // effect mutates is already flipped by the time this one reads it on
  // that very first pass, so gating on that would skip persisting nothing
  // and instead persist the *placeholder* over real stored data. Skipping
  // this effect's own first invocation, unconditionally, is what actually
  // corresponds to "before hydration ran".
  const persistedOnceRef = useRef(false);
  useEffect(() => {
    if (!persistedOnceRef.current) {
      persistedOnceRef.current = true;
      return;
    }
    if (typeof window === "undefined") return;
    try {
      storageRef.current?.setItem(STATE_KEY, JSON.stringify({ ...state, savedAt: now() }));
    } catch {
      // storage full or blocked; the flow continues in memory
    }
  }, [state]);

  const value = useMemo(() => ({ state, dispatch, ready }), [state, ready]);

  return <AllyContext.Provider value={value}>{children}</AllyContext.Provider>;
}
