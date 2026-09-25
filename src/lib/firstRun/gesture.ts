/**
 * Pure maths for the ChoiceRivers vertical gesture (first-run visuals spec
 * §4.4), ported from `verticalChoice` in the prototype. `b` is the balance
 * in [-1, 1]: positive means dragged down, which pulls the women river in.
 */

export type Side = "woman" | "man";
export interface Disabled {
  woman: boolean;
  man: boolean;
}

export const RUBBER_START = 0.85;
export const RUBBER_FACTOR = 0.35;
export const DISABLED_LIMIT = 0.12;
export const COMMIT_BALANCE = 0.42;
export const COMMIT_VELOCITY = 0.9; // px per ms
export const DRAG_SLOP = 7; // px
export const SPRING_K = 170;
export const SPRING_C = 2 * Math.sqrt(SPRING_K) * 0.78;
export const VELOCITY_SMOOTHING = 0.7;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Balance after dragging `dy` px from `b0`, in an arena `A` px tall. */
export function applyDrag(b0: number, dy: number, A: number, disabled: Disabled = { woman: false, man: false }): number {
  let nb = b0 + dy / (Math.max(A, 1) * 0.5);
  if (Math.abs(nb) > RUBBER_START) nb = Math.sign(nb) * (RUBBER_START + (Math.abs(nb) - RUBBER_START) * RUBBER_FACTOR);
  const hi = disabled.woman ? DISABLED_LIMIT : 1;
  const lo = disabled.man ? -DISABLED_LIMIT : -1;
  return clamp(nb, lo, hi);
}

/** Which side a release commits to, or null to spring back. */
export function decideRelease(b: number, vy: number, disabled: Disabled = { woman: false, man: false }): Side | null {
  let g: Side | null = null;
  if (b > COMMIT_BALANCE || vy > COMMIT_VELOCITY) g = "woman";
  else if (b < -COMMIT_BALANCE || vy < -COMMIT_VELOCITY) g = "man";
  if (g && disabled[g]) return null;
  return g;
}

/** Exponentially smoothed velocity, px per ms. */
export function smoothVelocity(prev: number, instantaneous: number): number {
  return VELOCITY_SMOOTHING * prev + (1 - VELOCITY_SMOOTHING) * instantaneous;
}

/** One semi-implicit Euler step of the damped spring toward `target`. */
export function springStep(b: number, v: number, target: number, dt: number): [number, number] {
  const a = -SPRING_K * (b - target) - SPRING_C * v;
  const nv = v + a * dt;
  return [b + nv * dt, nv];
}

/** The idle hint wiggle, `p` in [0, 1]. */
export function hintBalance(p: number): number {
  return Math.sin(p * Math.PI * 2) * 0.1 * (1 - p * 0.3);
}
