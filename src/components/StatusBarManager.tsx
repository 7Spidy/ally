"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

export function StatusBarManager() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    void (async () => {
      try {
        await StatusBar.setOverlaysWebView({ overlay: false });
        await StatusBar.setStyle({ style: Style.Dark });
        await StatusBar.setBackgroundColor({ color: "#151220" });
      } catch (err) {
        console.warn("StatusBar setup warning:", err);
      }
    })();
  }, []);

  return null;
}
