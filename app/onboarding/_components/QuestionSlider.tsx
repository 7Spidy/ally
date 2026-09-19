"use client";

import { useCallback, useRef, useState } from "react";
import styles from "./QuestionSlider.module.css";

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  } catch {
    /* unsupported: silent */
  }
}

export interface QuestionSliderProps {
  /** 4 for a detented slider (Q5, Q8); null for a continuous free slider (Q6, Q7, Q9). */
  stops: 4 | null;
  /** Current thumb position, 0 (top) .. 1 (bottom). null = untouched. */
  position: number | null;
  onChange: (position: number) => void;
  /** Detented sliders: 4 stop labels top-to-bottom. Continuous: [topPole, bottomPole]. */
  labels: readonly string[];
  ariaLabel: string;
}

/**
 * Vertical slider, ported behaviourally from `makeSlider()` in
 * ally-onboarding.html: 1:1 pointer tracking, haptic on each stop crossed
 * (detented) or on release (continuous), full keyboard support.
 */
export function QuestionSlider({ stops, position, onChange, labels, ariaLabel }: QuestionSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const lastStopRef = useRef<number>(-1);
  const v = position ?? 0.5;

  const nearestStop = useCallback((pos: number) => (stops ? Math.round(pos * (stops - 1)) : -1), [stops]);

  const fromEvent = useCallback((e: { clientY: number }) => {
    const el = trackRef.current;
    if (!el) return 0.5;
    const r = el.getBoundingClientRect();
    return clamp((e.clientY - r.top) / r.height, 0, 1);
  }, []);

  const applyMove = useCallback(
    (pos: number) => {
      if (stops) {
        const n = nearestStop(pos);
        if (n !== lastStopRef.current) {
          if (lastStopRef.current >= 0) vibrate(8);
          lastStopRef.current = n;
        }
      }
      onChange(pos);
    },
    [stops, nearestStop, onChange]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setDragging(true);
      applyMove(fromEvent(e));
    },
    [applyMove, fromEvent]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      applyMove(fromEvent(e));
    },
    [dragging, applyMove, fromEvent]
  );

  const onPointerUp = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    if (stops) {
      const n = nearestStop(v);
      onChange(n / (stops - 1));
    } else {
      vibrate([12, 40, 12]);
    }
  }, [dragging, stops, nearestStop, v, onChange]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (stops) {
        let n = lastStopRef.current < 0 ? nearestStop(v) : lastStopRef.current;
        let handled = true;
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") n = Math.max(0, n - 1);
        else if (e.key === "ArrowRight" || e.key === "ArrowUp") n = Math.min(stops - 1, n + 1);
        else if (e.key === "Home") n = 0;
        else if (e.key === "End") n = stops - 1;
        else handled = false;
        if (handled) {
          e.preventDefault();
          if (n !== lastStopRef.current) vibrate(8);
          lastStopRef.current = n;
          onChange(n / (stops - 1));
        }
      } else {
        let handled = true;
        let next = v;
        if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "Home") next = 0;
        else if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "End") next = 1;
        else handled = false;
        if (handled) {
          e.preventDefault();
          vibrate([12, 40, 12]);
          onChange(next);
        }
      }
    },
    [stops, nearestStop, v, onChange]
  );

  const isTwo = stops === null;
  const thumbTop = `calc(18px + (100% - 36px) * ${v})`;
  const nearest = stops ? nearestStop(v) : -1;

  return (
    <div className={`${styles.slider} ${isTwo ? styles.two : ""}`}>
      {isTwo && <span className={`${styles.opt} ${v <= 0.5 ? styles.sel : ""}`}>{labels[0]}</span>}
      <div className={styles.rail}>
        <div className={styles.track} ref={trackRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          {!isTwo && (
            <>
              {Array.from({ length: stops! }).map((_, i) => (
                <i key={i} className={styles.stop} style={{ top: `${(i / (stops! - 1)) * 100}%` }} />
              ))}
              <div
                className={styles.fill}
                style={
                  v < 0.5
                    ? { top: `${v * 100}%`, height: `${(0.5 - v) * 100}%` }
                    : { top: "50%", height: `${(v - 0.5) * 100}%` }
                }
              />
            </>
          )}
          {isTwo && (
            <div className={styles.fillTwo} style={v < 0.5 ? { top: `${v * 100}%`, height: `${(0.5 - v) * 100}%` } : { top: "50%", height: `${(v - 0.5) * 100}%` }} />
          )}
          <button
            type="button"
            className={styles.thumb}
            role="slider"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={stops ? stops - 1 : 100}
            aria-valuenow={stops ? Math.max(0, nearest) : Math.round(v * 100)}
            aria-label={ariaLabel}
            style={{ top: thumbTop }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
      {!isTwo ? (
        <div className={styles.labels}>
          {labels.map((l, i) => (
            <span key={l} className={`${styles.opt} ${nearest === i ? styles.sel : ""}`} style={{ top: `calc(18px + (100% - 36px) * ${i / (labels.length - 1)})` }} onClick={() => onChange(i / (stops! - 1))}>
              {l}
            </span>
          ))}
        </div>
      ) : (
        <span className={`${styles.opt} ${v > 0.5 ? styles.sel : ""}`}>{labels[1]}</span>
      )}
    </div>
  );
}
