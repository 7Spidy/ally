"use client";

import { useContext } from "react";
import { ToastContext } from "@/state/ToastProvider";
import styles from "./Toast.module.css";

/**
 * Renders the current toast message, if any. Mounted once in the root
 * layout as a sibling of `#app` (like `SheetHost`) so it isn't clipped by
 * `#app`'s `overflow: hidden`. Non-blocking: `pointer-events: none`, no
 * dismiss action, auto-clears via ToastProvider's timer.
 */
export function ToastHost() {
  const ctx = useContext(ToastContext);
  if (!ctx?.message) return null;
  return (
    <div className={styles.toast} role="status" aria-live="polite">
      {ctx.message}
    </div>
  );
}
