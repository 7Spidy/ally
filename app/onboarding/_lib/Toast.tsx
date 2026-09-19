"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import styles from "./Toast.module.css";

const ToastContext = createContext<((text: string) => void) | null>(null);

export function OnboardingToastProvider({ children }: { children: React.ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((t: string) => {
    setText(t);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setText(null), 3200);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {text && (
        <div className={styles.host}>
          <div className={styles.toast} role="status">
            {text}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

/** Fires the recompute toast (spec §9.3) from any onboarding page. */
export function useOnboardingToast() {
  const show = useContext(ToastContext);
  return show ?? (() => {});
}
