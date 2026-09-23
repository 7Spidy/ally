"use client";

import { createContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getBrowserClient } from "@/lib/supabase/browser";

export interface AuthContextValue {
  /** False until the initial getSession() has resolved. */
  ready: boolean;
  user: User | null;
  isAnonymous: boolean;
  email: string | null;
  hasPassword: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

function derive(user: User | null): Omit<AuthContextValue, "ready"> {
  return {
    user,
    isAnonymous: !!user && user.is_anonymous === true,
    email: user?.email ?? null,
    hasPassword: user?.user_metadata?.has_password === true,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const supabase = getBrowserClient();
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setReady(true);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ ready, ...derive(session?.user ?? null) }), [ready, session]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
