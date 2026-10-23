"use client";

import { useEffect, useRef } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { LONG_PRESS_MS } from "@/lib/config";
import { vibrate } from "@/lib/vibrate";

/** How far to drag right before releasing sends a reply, and the furthest the bubble follows. */
export const SWIPE_TRIGGER_PX = 56;
export const SWIPE_MAX_PX = 76;
/** Movement under this is still a press. */
const SLOP_PX = 10;

type Mode = "idle" | "swipe" | "scroll";

/**
 * One bubble's gestures: long-press (or right-click, or Enter) opens the
 * actions; dragging right past SWIPE_TRIGGER_PX and letting go replies.
 * The row's `--swipe` custom property follows the finger, set directly on the
 * element so a drag never re-renders the list. Vertical scrolling is left to
 * the browser: once the first movement is mostly vertical this stands down.
 */
export function useBubbleGestures({
  enabled,
  direction,
  onOpenActions,
  onSwipeReply,
}: {
  enabled: boolean;
  /** Which way a reply swipe goes: 1 for her bubbles (right), -1 for yours (left), toward the middle of the screen. */
  direction: 1 | -1;
  onOpenActions: () => void;
  onSwipeReply: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const mode = useRef<Mode>("idle");
  const fired = useRef(false);
  const armed = useRef(false);
  const cb = useRef({ onOpenActions, onSwipeReply });
  cb.current = { onOpenActions, onSwipeReply };

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const setSwipe = (px: number) => {
    const row = rowRef.current;
    if (!row) return;
    row.style.setProperty("--swipe", String(px * direction));
    row.style.setProperty("--pull", String(Math.min(1, px / SWIPE_TRIGGER_PX)));
  };
  const reset = () => {
    clearTimer();
    mode.current = "idle";
    armed.current = false;
    const row = rowRef.current;
    if (row) {
      row.dataset.released = "true";
      delete row.dataset.armed;
      setSwipe(0);
    }
  };

  useEffect(() => clearTimer, []);

  if (!enabled) return { rowRef, bind: {} as Record<string, never> };

  const bind = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY };
      mode.current = "idle";
      fired.current = false;
      armed.current = false;
      if (rowRef.current) delete rowRef.current.dataset.released;
      clearTimer();
      timer.current = setTimeout(() => {
        if (mode.current !== "idle") return;
        fired.current = true;
        vibrate([12]);
        cb.current.onOpenActions();
      }, LONG_PRESS_MS);
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const dx = (e.clientX - start.current.x) * direction;
      const dy = e.clientY - start.current.y;
      if (mode.current === "idle" && (Math.abs(dx) > SLOP_PX || Math.abs(dy) > SLOP_PX)) {
        clearTimer();
        if (Math.abs(dx) > Math.abs(dy) && dx > 0) {
          mode.current = "swipe";
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* a synthetic pointer: nothing to capture */
          }
        } else {
          mode.current = "scroll";
        }
      }
      if (mode.current !== "swipe") return;
      const px = Math.max(0, Math.min(SWIPE_MAX_PX, dx));
      setSwipe(px);
      const nowArmed = px >= SWIPE_TRIGGER_PX;
      if (nowArmed && !armed.current) vibrate([8]);
      armed.current = nowArmed;
      if (rowRef.current) {
        if (nowArmed) rowRef.current.dataset.armed = "true";
        else delete rowRef.current.dataset.armed;
      }
    },
    onPointerUp() {
      const wasSwipe = mode.current === "swipe";
      const doReply = wasSwipe && armed.current;
      reset();
      if (doReply) cb.current.onSwipeReply();
    },
    onPointerCancel() {
      reset();
    },
    onContextMenu(e: MouseEvent<HTMLElement>) {
      e.preventDefault();
      clearTimer();
      if (!fired.current) {
        fired.current = true;
        cb.current.onOpenActions();
      }
    },
    onKeyDown(e: KeyboardEvent<HTMLElement>) {
      if (e.key === "Enter" && e.target === e.currentTarget) {
        e.preventDefault();
        cb.current.onOpenActions();
      }
    },
  };
  return { rowRef, bind };
}
