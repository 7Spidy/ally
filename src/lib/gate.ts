/**
 * The under-18 age gate, spec §8.5 (PRD), ported from `applyGate` in
 * `#ally-engine`. Pure: given a DOB and "now", decides whether the answer
 * is blocked and what to persist. The caller (the birthday screen) is
 * responsible for actually writing `ally_blocked_until` to storage and
 * discarding the DOB from flow state when blocked.
 */

import { ageAt } from "@/lib/engine";
import { BLOCK_DAYS } from "@/lib/config";

export interface GateResult {
  blocked: boolean;
  age: number | null;
  dob: string | null;
  blockedUntil: number | null;
}

export function applyGate(dobISO: string, now: number): GateResult {
  const age = ageAt(dobISO, new Date(now));
  if (age < 18) {
    return { blocked: true, age: null, dob: null, blockedUntil: now + BLOCK_DAYS * 86400000 };
  }
  return { blocked: false, age, dob: dobISO, blockedUntil: null };
}
