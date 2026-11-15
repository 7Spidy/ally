"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

/**
 * Registers /sw.js so the web app can be installed. Production only, and never
 * inside the native shell, where the app already is installed.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (Capacitor.isNativePlatform()) return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* installability is a nicety; the app works without it */
    });
  }, []);
  return null;
}
