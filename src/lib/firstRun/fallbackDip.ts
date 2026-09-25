/**
 * Splash fallback transition (no WebGL, a lost context, or reduced motion):
 * a sequential dip, never a crossfade. The outgoing face fades out to the
 * palette wash over DIP_OUT_MS, then the incoming face fades in over
 * DIP_IN_MS, so the two are never partly visible at the same moment.
 */

export const DIP_OUT_MS = 320;
export const DIP_IN_MS = 420;
export const DIP_TOTAL_MS = DIP_OUT_MS + DIP_IN_MS;

const smooth = (p: number) => p * p * (3 - 2 * p);
const clamp01 = (p: number) => Math.min(1, Math.max(0, p));

/** Opacities of the outgoing and incoming image `t` ms into the dip. */
export function fallbackOpacities(t: number): { outgoing: number; incoming: number } {
  const outgoing = t >= DIP_OUT_MS ? 0 : 1 - smooth(clamp01(t / DIP_OUT_MS));
  const incoming = t <= DIP_OUT_MS ? 0 : smooth(clamp01((t - DIP_OUT_MS) / DIP_IN_MS));
  return { outgoing, incoming };
}
