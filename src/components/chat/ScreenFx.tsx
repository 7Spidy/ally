"use client";

import { useEffect, useRef } from "react";
import styles from "./ScreenFx.module.css";

export type ScreenKind = "confetti" | "lanterns" | "rain" | "petals";

const DURATION_MS = 4200;
const WASH_MS = 400;
const TINT: Record<ScreenKind, string> = { confetti: "#f4c95d", lanterns: "#ff9a3c", rain: "#6fa8dc", petals: "#e88ea0" };
const COLORS: Record<ScreenKind, string[]> = {
  confetti: ["#f4c95d", "#e88ea0", "#6fa8dc", "#9ad1a0", "#f4efe6"],
  lanterns: ["#ffb347", "#ff9a3c", "#ffd08a"],
  rain: ["#a9c7e8", "#6fa8dc"],
  petals: ["#e88ea0", "#f5b7c2", "#c96b7e"],
};

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
  c: string;
  r: number;
}

/**
 * One canvas overlay, 4.2 s. Reduced motion: no particles, a single 400 ms
 * colour wash instead.
 */
export function ScreenFx({ kind, onDone }: { kind: ScreenKind; onDone: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reduced) {
      const t = setTimeout(() => doneRef.current(), WASH_MS);
      return () => clearTimeout(t);
    }
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      doneRef.current();
      return;
    }
    const w = (canvas.width = window.innerWidth);
    const h = (canvas.height = window.innerHeight);
    const colors = COLORS[kind];
    const n = kind === "rain" ? 90 : 60;
    const ps: P[] = Array.from({ length: n }, (_, i) => ({
      x: Math.random() * w,
      y: kind === "lanterns" ? h + Math.random() * h * 0.3 : -Math.random() * h * 0.5,
      vx: (Math.random() - 0.5) * (kind === "rain" ? 0.6 : 2),
      vy: kind === "lanterns" ? -(0.8 + Math.random() * 1.2) : kind === "rain" ? 9 + Math.random() * 5 : 1.5 + Math.random() * 2.5,
      s: kind === "rain" ? 12 + Math.random() * 10 : 5 + Math.random() * 8,
      c: colors[i % colors.length],
      r: Math.random() * Math.PI,
    }));
    const start = performance.now();
    let raf = 0;
    const frame = (t: number) => {
      const p = (t - start) / DURATION_MS;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = p > 0.8 ? Math.max(0, (1 - p) / 0.2) : 1;
      if (kind === "petals") {
        // heartbeat tint pulse
        ctx.fillStyle = TINT.petals;
        ctx.globalAlpha *= 0.08 + 0.06 * Math.max(0, Math.sin(p * Math.PI * 8));
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = p > 0.8 ? Math.max(0, (1 - p) / 0.2) : 1;
      }
      for (const q of ps) {
        q.x += q.vx;
        q.y += q.vy;
        q.r += 0.05;
        ctx.fillStyle = q.c;
        ctx.strokeStyle = q.c;
        if (kind === "rain") {
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(q.x + q.vx, q.y + q.s);
          ctx.stroke();
        } else if (kind === "lanterns") {
          const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.s * 3);
          g.addColorStop(0, q.c);
          g.addColorStop(1, "transparent");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(q.x, q.y, q.s * 3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.save();
          ctx.translate(q.x, q.y);
          ctx.rotate(q.r);
          if (kind === "petals") ctx.scale(1, 0.55);
          ctx.fillRect(-q.s / 2, -q.s / 4, q.s, q.s / 2);
          ctx.restore();
        }
      }
      if (t - start < DURATION_MS) raf = requestAnimationFrame(frame);
      else doneRef.current();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [kind, reduced]);

  if (reduced) return <div className={styles.wash} style={{ background: TINT[kind] }} data-testid="screen-wash" aria-hidden />;
  return <canvas ref={ref} className={styles.canvas} data-testid="screen-fx" aria-hidden />;
}
