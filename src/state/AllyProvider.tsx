"use client";

import { createContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AllyState } from "@/state/schema";
import { allyReducer, type AllyAction } from "@/state/allyReducer";
import { migrate, stateKeyFor, type RemovableStorage } from "@/lib/migrate";
import { now } from "@/lib/clock";
import { useAuth } from "@/state/useAuth";

export interface AllyContextValue {
  state: AllyState;
  dispatch: React.Dispatch<AllyAction>;
  /**
   * False until auth is ready AND the post-mount hydration effect has
   * replaced the SSR-safe placeholder with the real state for the current
   * owner. React fires a descendant's effects before its ancestors', so a
   * page's own mount effect (e.g. app/page.tsx's boot decision) can
   * otherwise run BEFORE this provider's hydration effect and read the
   * placeholder as if it were real — always a fresh, companion-less state.
   * Anything that makes a one-shot decision from `state` on mount must gate
   * on `ready` first.
   */
  ready: boolean;
  /**
   * The Supabase user id the in-memory state belongs to, or null. Callers
   * that change identity (consent's anonymous sign-in) wait for this to
   * equal the new uid before navigating, so the adoption in the effect
   * below has carried the in-memory flow across.
   */
  ownerId: string | null;
}

export const AllyContext = createContext<AllyContextValue | null>(null);

function safeStorage(): RemovableStorage {
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
      removeItem: (k) => void mem.delete(k),
    };
  }
}

const EMPTY_STORAGE: RemovableStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

export function AllyProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const uid = auth.user?.id ?? null;
  const storageRef = useRef<RemovableStorage | null>(null);
  // Whether the previous owner was anonymous, so a uidA -> uidB switch knows
  // to drop the abandoned anonymous user's local key.
  const prevAnonRef = useRef(false);

  // The initial render MUST be identical on the server and on the client's
  // first (pre-hydration) pass, or React throws a hydration mismatch.
  // migrate() against real localStorage is only safe to run once mounted —
  // reading it here (even gated on `typeof window`) diverges from the
  // server's placeholder the moment the client renders for the first time,
  // since `typeof window !== 'undefined'` is already true by then. So the
  // initial state is always the same deterministic placeholder; the real
  // state is read in the effect below and applied via HYDRATE, strictly
  // after mount.
  const initial = useMemo<AllyState>(() => migrate(EMPTY_STORAGE, 0), []);

  const [state, dispatch] = useReducer(allyReducer, initial);
  const [owner, setOwner] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Runs on mount (once auth is ready) and on every identity change. The
  // owner and the state land in one batched render, so the persist effect
  // below can never write one user's state under another user's key.
  useEffect(() => {
    if (!auth.ready) return;
    if (!storageRef.current) storageRef.current = safeStorage();
    const storage = storageRef.current;
    const nowMs = now();

    if (hydrated && uid === owner) {
      prevAnonRef.current = auth.isAnonymous;
      return;
    }

    if (uid === null) {
      // First boot with no session, or logout: a fresh placeholder in memory.
      // The signed-out user's `ally_v2:<uid>` is left alone (device-local until P2).
      dispatch({ type: "HYDRATE", state: migrate(EMPTY_STORAGE, nowMs) });
      setOwner(null);
      setHydrated(true);
      prevAnonRef.current = false;
      return;
    }

    const key = stateKeyFor(uid);
    const stored = storage.getItem(key);

    if (owner === null && hydrated && stored === null && auth.isAnonymous) {
      // none -> anonymous uid with nothing stored: ADOPT the in-memory state
      // (the consent step signs in anonymously mid-flow) and persist it under
      // the new key via the effect below. A permanent user logging in on a
      // fresh device takes the normal hydrate path instead, so their
      // account record is set up below.
      setOwner(uid);
      prevAnonRef.current = auth.isAnonymous;
      return;
    }

    // Normal returning load, returning login, or a switch between users.
    if (owner !== null && owner !== uid && prevAnonRef.current) {
      try {
        storage.removeItem(stateKeyFor(owner));
      } catch {
        /* storage blocked */
      }
    }
    const next = migrate(storage, nowMs, key);
    dispatch({ type: "HYDRATE", state: next });
    dispatch({ type: "PURGE_PARTED", now: nowMs });
    // A permanent user logging in on a device where the account step never ran.
    if (!auth.isAnonymous && auth.email && next.user.accountAt === null) {
      dispatch({ type: "ACCOUNT_SAVE", contact: auth.email, kind: "email", now: nowMs });
    }
    setOwner(uid);
    setHydrated(true);
    prevAnonRef.current = auth.isAnonymous;
  }, [auth.ready, auth.isAnonymous, auth.email, uid, owner, hydrated]);

  // Persist on every change while a user owns the state. With no owner the
  // state lives in memory only, and the placeholder is never written.
  useEffect(() => {
    if (owner === null || !hydrated) return;
    try {
      storageRef.current?.setItem(stateKeyFor(owner), JSON.stringify({ ...state, savedAt: now() }));
    } catch {
      // storage full or blocked; the flow continues in memory
    }
  }, [state, owner, hydrated]);

  const ready = auth.ready && hydrated && owner === uid;
  const value = useMemo(() => ({ state, dispatch, ready, ownerId: owner }), [state, ready, owner]);

  return <AllyContext.Provider value={value}>{children}</AllyContext.Provider>;
}
