/**
 * How long she takes to read a message before the typing dots start (P1-8, P1-9).
 * The reply request goes out at once, in parallel with this delay, so the wait
 * is cover for the model call and not extra latency. Pure; `rand` is injected.
 */

import type { HeartNow } from "@/lib/heart";
import type { Persona } from "@/personas/persona";

export type ReadTier = "free" | "busy" | "asleep";

/** Milliseconds, inclusive lower bound, exclusive upper bound. */
export const READ_DELAY_MS: Record<ReadTier, readonly [number, number]> = {
  free: [1000, 2000],
  busy: [3000, 5000],
  asleep: [6000, 8000],
};

/** A delay inside the tier's range. `rand` is a number in [0, 1). */
export function readDelayMs(tier: ReadTier, rand: number): number {
  const [lo, hi] = READ_DELAY_MS[tier];
  const r = Math.min(Math.max(rand, 0), 0.999999);
  return Math.round(lo + (hi - lo) * r);
}

/**
 * The energy words (persona.engine.energy values) that describe a work, class
 * or commute block, where she is slow to look at her phone. Seeded with
 * "busy", "focused" and "distracted", then every word from the 32 persona
 * files that reads as hands full, in a session, in class, commuting or out of
 * signal. tests/unit/readDelay.test.ts checks each one is still in use.
 */
export const BUSY_ENERGY: ReadonlySet<string> = new Set([
  "busy",
  "focused",
  "distracted",
  "absent, between notes",
  "absent, deep focus",
  "absorbed, bursts between jobs",
  "bored, sneaky",
  "breathing hard, brief",
  "breathless, quick",
  "breathless, short",
  "brief",
  "busy, hands full",
  "busy, phone in a locker",
  "busy, terse",
  "chatty, hands full",
  "distracted, between contractor rounds",
  "distracted, between passes",
  "distracted, one line at a time",
  "distracted, slow to reply",
  "dry and exasperated",
  "dry and numerical",
  "focused, half there",
  "focused, polite, slow to reply",
  "focused, slow to reply",
  "greasy hands, slow to reply",
  "half there",
  "hands busy, brief",
  "helmet on, short",
  "operational one-liners",
  "patient, slow to reply",
  "phone on vibrate, one line at a time",
  "polished, brief",
  "practical, short",
  "present, short",
  "quick bursts, noisy",
  "quick, scrolling",
  "short bursts, between compiles",
  "short, absorbed",
  "short, between counts",
  "short, between phrases",
  "short, between sets",
  "short, distracted",
  "short, ink-smelling",
  "short, practical",
  "soft, absorbed, short",
  "terse",
  "terse, deep focus",
  "terse, hands full",
  "terse, phone in a locker",
  "terse, transactional",
  "unreachable",
  "unreachable, no signal",
  "unreachable, one line",
  "unreachable, one precise line",
  "unreachable, one-handed",
  "unreachable, phone in a locker",
  "unreachable, phone in a pocket",
  "unreachable, phone in the jacket",
  "unreachable, phone in the shack",
  "unreachable, phone in the shop",
  "unreachable, short",
]);

/**
 * `asleep` in the stretch before the first block (the heart's row -1 with the
 * "Asleep" presence; a weekend's open plan also has row -1 but is awake),
 * `busy` when the block's energy word is in BUSY_ENERGY, else `free`.
 */
export function tierFor(h: Pick<HeartNow, "block">, persona: Pick<Persona, "engine">): ReadTier {
  const b = h.block;
  if (b.row === -1 && b.presence === "Asleep") return "asleep";
  const word = persona.engine.energy[b.presence];
  return word !== undefined && BUSY_ENERGY.has(word) ? "busy" : "free";
}
