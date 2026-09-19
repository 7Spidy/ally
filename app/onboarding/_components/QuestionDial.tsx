"use client";

import { useCallback, useRef, useState } from "react";
import styles from "./QuestionDial.module.css";

function vibrate(pattern: number | number[]) {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  } catch {
    /* unsupported */
  }
}

const C = 150;
const R = 110;
const START = 150;
const SWEEP = 240;

function pt(deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [C + R * Math.cos(a), C + R * Math.sin(a)];
}

export interface QuestionDialProps {
  labels: readonly string[]; // exactly 6
  index: number | null;
  onChange: (index: number) => void;
  ariaLabel: string;
}

/** Radial dial, 6 detents over ~240deg, ported behaviourally from `setupDial()`. */
export function QuestionDial({ labels, index, onChange, ariaLabel }: QuestionDialProps) {
  const n = labels.length;
  const dialRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [liveIndex, setLiveIndex] = useState(index ?? -1);
  const sel = dragging ? liveIndex : index ?? liveIndex;

  const fromEvent = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const el = dialRef.current;
      if (!el) return 0;
      const r = el.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 300;
      const y = ((e.clientY - r.top) / r.height) * 300;
      let a = (Math.atan2(y - C, x - C) * 180) / Math.PI;
      if (a < 0) a += 360;
      if (a < START) a += 360;
      if (a > START + SWEEP) a = a < START + SWEEP + 60 ? START + SWEEP : START;
      const t = (a - START) / SWEEP;
      return Math.round(t * (n - 1));
    },
    [n]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      setDragging(true);
      const i = fromEvent(e);
      if (i !== liveIndex) vibrate(8);
      setLiveIndex(i);
    },
    [fromEvent, liveIndex]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      const i = fromEvent(e);
      if (i !== liveIndex) {
        vibrate(8);
        setLiveIndex(i);
      }
    },
    [dragging, fromEvent, liveIndex]
  );

  const onPointerUp = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    if (liveIndex >= 0) onChange(liveIndex);
  }, [dragging, liveIndex, onChange]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let i = sel < 0 ? -1 : sel;
      let handled = true;
      if (e.key === "ArrowRight" || e.key === "ArrowUp") i = Math.min(n - 1, i + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowDown") i = Math.max(0, i - 1);
      else if (e.key === "Home") i = 0;
      else if (e.key === "End") i = n - 1;
      else handled = false;
      if (handled) {
        e.preventDefault();
        if (i !== sel) vibrate(8);
        setLiveIndex(i);
        onChange(i);
      }
    },
    [sel, n, onChange]
  );

  const thumb = sel >= 0 ? pt(START + (SWEEP / (n - 1)) * sel) : null;
  const [sx, sy] = pt(START);
  const [ex, ey] = pt(START + SWEEP);

  return (
    <div className={styles.dial} ref={dialRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <svg viewBox="0 0 300 300" aria-hidden="true">
        <path className={styles.arc} d={`M ${sx} ${sy} A ${R} ${R} 0 1 1 ${ex} ${ey}`} />
        {Array.from({ length: n }).map((_, i) => {
          const [x, y] = pt(START + (SWEEP / (n - 1)) * i);
          return <circle key={i} className={`${styles.tick} ${i === sel ? styles.tickSel : ""}`} cx={x} cy={y} r={7} />;
        })}
        {thumb && <circle className={styles.thumbDot} r={17} cx={thumb[0]} cy={thumb[1]} />}
      </svg>
      <div className={styles.label} aria-live="polite">
        {labels.map((l, i) => (
          <div key={l} className={`${styles.row} ${i === sel ? styles.rowSel : ""}`}>
            {l}
          </div>
        ))}
      </div>
      <button
        type="button"
        className={styles.kb}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={n - 1}
        aria-valuenow={Math.max(0, sel)}
        aria-valuetext={sel >= 0 ? labels[sel] : "Nothing chosen"}
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
