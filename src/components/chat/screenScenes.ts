/**
 * The four B3 screen effects, drawn on the same canvas ScreenFx already owns.
 * Each scene is created once with the canvas size and then asked to draw a
 * frame at progress p (0 to 1 over the 4.2 s run). Nothing here touches the
 * DOM or the clock, so a scene is the same for the same random numbers.
 */

export type NewScreenKind = "balloons" | "fireworks" | "shootingstar" | "sparkles";

export interface Scene {
  /** `fade` is the whole-scene fade (1 until the last fifth of the run), which a scene multiplies into its own alpha. */
  draw: (ctx: CanvasRenderingContext2D, p: number, fade: number) => void;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

const BALLOON = ["#f4c95d", "#e88ea0", "#6fa8dc", "#9ad1a0", "#f4efe6", "#c96b7e"] as const;
const FIREWORK = ["#f4c95d", "#ff9a3c", "#e88ea0", "#a9c7e8", "#f4efe6"] as const;

function balloons(w: number, h: number): Scene {
  const n = 26;
  const bs = Array.from({ length: n }, () => ({
    x: rand(0.04, 0.96) * w,
    y: h + rand(0.05, 0.9) * h,
    r: rand(16, 28),
    vy: rand(1.5, 2.9),
    sway: rand(0.6, 1.6),
    phase: rand(0, Math.PI * 2),
    c: pick(BALLOON),
  }));
  return {
    draw(ctx, p) {
      for (const b of bs) {
        b.y -= b.vy;
        const x = b.x + Math.sin(p * 9 + b.phase) * 14 * b.sway;
        // string
        ctx.strokeStyle = "rgba(244,239,230,0.55)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, b.y + b.r * 1.15);
        ctx.quadraticCurveTo(x + 8 * Math.sin(p * 12 + b.phase), b.y + b.r * 2.2, x, b.y + b.r * 3.1);
        ctx.stroke();
        // body
        ctx.fillStyle = b.c;
        ctx.beginPath();
        ctx.ellipse(x, b.y, b.r * 0.82, b.r, 0, 0, Math.PI * 2);
        ctx.fill();
        // knot and highlight
        ctx.beginPath();
        ctx.moveTo(x - 3, b.y + b.r * 1.12);
        ctx.lineTo(x + 3, b.y + b.r * 1.12);
        ctx.lineTo(x, b.y + b.r * 0.98);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath();
        ctx.ellipse(x - b.r * 0.3, b.y - b.r * 0.35, b.r * 0.16, b.r * 0.3, -0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
}

function fireworks(w: number, h: number): Scene {
  // Five bursts spread across the run; each is a ring of sparks that arcs and fades.
  const bursts = Array.from({ length: 5 }, (_, i) => {
    const c = pick(FIREWORK);
    const count = 38;
    return {
      at: 0.04 + i * 0.16 + rand(0, 0.05),
      x: rand(0.2, 0.8) * w,
      y: rand(0.16, 0.5) * h,
      c,
      sparks: Array.from({ length: count }, (_, k) => {
        const a = (k / count) * Math.PI * 2 + rand(-0.05, 0.05);
        const sp = rand(2.2, 5.4);
        return { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp };
      }),
    };
  });
  const LIFE = 0.3; // each burst lasts 30% of the run
  return {
    draw(ctx, p, fade) {
      for (const b of bursts) {
        const t = (p - b.at) / LIFE;
        if (t < 0 || t > 1) continue;
        const f = t * 60; // frames since the burst, at roughly 60 fps over LIFE of 4.2 s
        const alpha = Math.max(0, 1 - t * t);
        ctx.fillStyle = b.c;
        // a white flash on the first few frames
        if (t < 0.06) {
          ctx.globalAlpha = (fade * (0.06 - t)) / 0.06;
          ctx.beginPath();
          ctx.arc(b.x, b.y, 26, 0, Math.PI * 2);
          ctx.fillStyle = "#fff";
          ctx.fill();
          ctx.fillStyle = b.c;
        }
        for (const s of b.sparks) {
          const x = b.x + s.vx * f * 0.9;
          const y = b.y + s.vy * f * 0.9 + 0.022 * f * f;
          ctx.globalAlpha = fade * alpha;
          ctx.beginPath();
          ctx.arc(x, y, 2.4 * (1 - t * 0.6), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = fade;
    },
  };
}

function shootingstar(w: number, h: number): Scene {
  const stars = Array.from({ length: 70 }, () => ({ x: Math.random() * w, y: Math.random() * h * 0.8, r: rand(0.6, 1.8), phase: rand(0, 6.28) }));
  const streaks = Array.from({ length: 4 }, (_, i) => ({
    at: 0.06 + i * 0.2 + rand(0, 0.06),
    x: rand(0.35, 1.05) * w,
    y: rand(0.02, 0.4) * h,
    len: rand(150, 260),
    speed: rand(0.9, 1.3),
  }));
  const DUR = 0.22;
  return {
    draw(ctx, p, fade) {
      ctx.fillStyle = "#f4efe6";
      for (const s of stars) {
        ctx.globalAlpha = fade * (0.2 + 0.35 * (0.5 + 0.5 * Math.sin(p * 18 + s.phase)));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const k of streaks) {
        const t = (p - k.at) / DUR;
        if (t < 0 || t > 1) continue;
        const hx = k.x - t * w * 0.75 * k.speed;
        const hy = k.y + t * h * 0.35 * k.speed;
        const ang = Math.atan2(h * 0.35, -w * 0.75);
        const tx = hx - Math.cos(ang) * k.len;
        const ty = hy - Math.sin(ang) * k.len;
        const g = ctx.createLinearGradient(hx, hy, tx, ty);
        g.addColorStop(0, "rgba(255,255,255,0.95)");
        g.addColorStop(1, "rgba(244,201,93,0)");
        ctx.globalAlpha = fade * Math.sin(Math.min(1, t) * Math.PI);
        ctx.strokeStyle = g;
        ctx.lineWidth = 2.6;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(hx, hy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = fade;
    },
  };
}

/** A four-point star: two crossed diamonds. */
function star4(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

function sparkles(w: number, h: number): Scene {
  const ss = Array.from({ length: 46 }, () => ({
    x: rand(0.03, 0.97) * w,
    y: rand(0.05, 0.95) * h,
    r: rand(7, 20),
    at: rand(0, 0.72),
    life: rand(0.16, 0.3),
    c: pick(["#f4c95d", "#fff3c4", "#f4efe6", "#ffd9a0"] as const),
  }));
  return {
    draw(ctx, p, fade) {
      for (const s of ss) {
        const t = (p - s.at) / s.life;
        if (t < 0 || t > 1) continue;
        const k = Math.sin(t * Math.PI); // in and out
        ctx.globalAlpha = fade * k;
        ctx.fillStyle = s.c;
        star4(ctx, s.x, s.y, s.r * (0.4 + 0.6 * k));
      }
      ctx.globalAlpha = fade;
    },
  };
}

const FACTORY: Record<NewScreenKind, (w: number, h: number) => Scene> = { balloons, fireworks, shootingstar, sparkles };

export function isNewScreen(kind: string): kind is NewScreenKind {
  return kind in FACTORY;
}

export function makeScene(kind: NewScreenKind, w: number, h: number): Scene {
  return FACTORY[kind](w, h);
}
