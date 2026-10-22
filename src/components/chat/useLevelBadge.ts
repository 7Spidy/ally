"use client";

import { useEffect, useRef, useState } from "react";

/** Total time the badge is on screen: 150 ms fade in, 700 ms hold, 150 ms fade out. */
export const LEVEL_BADGE_MS = 1000;
/** A tab hidden for at least this long shows the badge again when it comes back. */
export const LEVEL_BADGE_AWAY_MS = 60_000;

/** True when a tab hidden since `hiddenAt` has been away long enough to re-show the badge. */
export function awayLongEnough(hiddenAt: number | null, nowMs: number): boolean {
  return hiddenAt !== null && nowMs - hiddenAt >= LEVEL_BADGE_AWAY_MS;
}

/**
 * Whether the level badge is showing. It shows when `chatKey` becomes non-null
 * (a live chat opened) and when the tab turns visible after 60 s or more
 * hidden. Re-renders, new messages and level changes never re-trigger it.
 * Pass null for chats that never show it.
 */
export function useLevelBadge(chatKey: string | null): boolean {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (chatKey === null) return;
    const show = () => {
      if (timer.current) clearTimeout(timer.current);
      setVisible(true);
      timer.current = setTimeout(() => setVisible(false), LEVEL_BADGE_MS);
    };
    show();

    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (awayLongEnough(hiddenAt, Date.now())) show();
      hiddenAt = null;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setVisible(false);
    };
  }, [chatKey]);

  return visible;
}
