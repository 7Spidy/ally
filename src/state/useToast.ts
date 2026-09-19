"use client";

import { useContext } from "react";
import { ToastContext } from "@/state/ToastProvider";

/** Returns `showToast(message)`. Throws outside `ToastProvider`. */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx.showToast;
}
