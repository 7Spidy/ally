/**
 * Haptics for the Constellation. `navigator.vibrate` is absent on iOS Safari
 * (there is no Vibration API there), so every call is guarded and wrapped: on
 * iOS it is a silent no-op, and a browser that throws never affects the caller.
 */

/** One heartbeat: thump, pause, thump. */
export const BEAT_BUZZ: readonly number[] = [35, 80, 25];
/** The reveal: builds towards the flood. */
export const REVEAL_BUZZ: readonly number[] = [20, 40, 70];

export function vibrate(pattern: readonly number[]): void {
  try {
    if (typeof navigator === "undefined") return;
    // Chrome refuses (and logs an error) until the user has tapped the page,
    // e.g. after a refresh mid-animation. Where userActivation is unknown, try.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    navigator.vibrate?.([...pattern]);
  } catch {
    /* unsupported or blocked: silent */
  }
}
