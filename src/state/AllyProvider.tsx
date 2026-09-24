"use client";

import { createContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { AllyState } from "@/state/schema";
import { allyReducer, type AllyAction } from "@/state/allyReducer";
import { localOnly, migrate, stateKeyFor, type RemovableStorage } from "@/lib/migrate";
import { dayKey, now, setServerTime } from "@/lib/clock";
import { assembleServerState, getMyState } from "@/lib/supabase/queries";
import { useAuth } from "@/state/useAuth";

/** Delay before retrying a failed get_my_state on boot. */
const LOAD_RETRY_MS = 3000;

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
  /**
   * True while the latest get_my_state attempt has failed and a retry is
   * pending. Cleared when a load succeeds. AllyGate shows it to the user.
   */
  loadFailed: boolean;
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
  // Bumped to retry a failed server load.
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);

  // Runs on mount (once auth is ready) and on every identity change. The
  // owner and the state land in one batched render, so the persist effect
  // below can never write one user's state under another user's key.
  //
  // P2: companions and the ledger come from get_my_state; only `flow` and
  // `user` come from the local `ally_v2:<uid>` blob (spec §6.1). `ready`
  // stays false until the server load lands; a failed load retries.
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
      // The signed-out user's `ally_v2:<uid>` (flow and preferences) is left alone.
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
      // the new key via the effect below. A brand-new anonymous user has no
      // server rows yet, so there is nothing to load. A permanent user
      // logging in on a fresh device takes the server load below instead,
      // so their account record is set up there.
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
    const isAnonymous = auth.isAnonymous;
    const email = auth.email;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    getMyState()
      .then((server) => {
        if (cancelled) return;
        setServerTime(server.server_now);
        const nowMs = now();
        // Only flow and user are read from the local blob (spec D1, §6.4).
        const local = localOnly(migrate(storage, nowMs, key), dayKey(nowMs));
        const { companions, ledger } = assembleServerState(server);
        // D7: the display name and consent come from profiles/consents when
        // the server has them (a new device has no local copy).
        const user = {
          ...local.user,
          displayName: server.profile?.display_name || local.user.displayName,
          consentAt: local.user.consentAt ?? server.consent?.granted_at ?? null,
          consentMarketing: local.user.consentAt !== null ? local.user.consentMarketing : (server.consent?.marketing ?? false),
        };
        // A first-run flow can't coexist with companions (CONFIRM_LOCK clears
        // it); on a new device the fresh local blob would otherwise carry one.
        const flow = companions.length > 0 && local.flow?.kind === "first" ? null : local.flow;
        dispatch({ type: "HYDRATE", state: { ...local, user, flow, companions, ledger } });
        // A permanent user logging in on a device where the account step never ran.
        if (!isAnonymous && email && user.accountAt === null) {
          dispatch({ type: "ACCOUNT_SAVE", contact: email, kind: "email", now: nowMs });
        }
        setOwner(uid);
        setHydrated(true);
        setLoadFailed(false);
        prevAnonRef.current = isAnonymous;
      })
      .catch(() => {
        if (cancelled) return;
        // Stays set through the retries (no flicker between attempts) until a load succeeds.
        setLoadFailed(true);
        retry = setTimeout(() => setLoadAttempt((n) => n + 1), LOAD_RETRY_MS);
      });
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [auth.ready, auth.isAnonymous, auth.email, uid, owner, hydrated, loadAttempt]);

  // Persist on every change while a user owns the state. With no owner the
  // state lives in memory only, and the placeholder is never written. Only
  // flow and user are stored; companions and the ledger live on the server.
  useEffect(() => {
    if (owner === null || !hydrated) return;
    try {
      const nowMs = now();
      storageRef.current?.setItem(stateKeyFor(owner), JSON.stringify({ ...localOnly(state, state.ledger.day), savedAt: nowMs }));
    } catch {
      // storage full or blocked; the flow continues in memory
    }
  }, [state, owner, hydrated]);

  const ready = auth.ready && hydrated && owner === uid;
  const value = useMemo(() => ({ state, dispatch, ready, ownerId: owner, loadFailed }), [state, ready, owner, loadFailed]);

  return <AllyContext.Provider value={value}>{children}</AllyContext.Provider>;
}
