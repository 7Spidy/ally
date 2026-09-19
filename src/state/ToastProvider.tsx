"use client";

import { createContext, useCallback, useRef, useState } from "react";

/**
 * Minimal toast infrastructure — nothing like it existed before this work
 * area needed it (spec §6 unlock/day-pass toasts). `showToast` sets the
 * current message; it auto-clears after ~3s. `ToastContext.message` is read
 * by `ToastHost` (src/components/Toast.tsx), which is mounted as a sibling
 * of `#app` in the root layout so it isn't clipped by `#app`'s
 * `overflow: hidden` (the same reason `SheetHost` lives there).
 */
export interface ToastContextValue {
  message: string | null;
  showToast: (message: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_MS = 3000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setMessage(msg);
    timerRef.current = setTimeout(() => setMessage(null), TOAST_MS);
  }, []);

  return <ToastContext.Provider value={{ message, showToast }}>{children}</ToastContext.Provider>;
}
