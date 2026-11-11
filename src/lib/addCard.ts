/** Spec §8.4: the add-card state table, evaluated in order. Pure. */

import type { Entitlement } from "@/state/schema";

export type AddCardKind = "add" | "cap" | "exhausted";

/**
 * "cap" is the end of the road: an Ultra user (the top plan) has every slot full
 * (the "part with an Ally" message). Below that, a full set of the plan's slots is
 * still an "add" card; its button goes to the plans screen instead of the intro sheet.
 */
export function addCardState(activeCount: number, bothPoolsEmpty: boolean, ent: Entitlement): AddCardKind {
  if (ent.plan === "ultra" && activeCount >= ent.slotLimit) return "cap";
  if (bothPoolsEmpty) return "exhausted";
  return "add";
}

/** Where the "+" / Start button of the add card leads for this plan. */
export type AddCardTarget = "intro" | "plans-newally" | "plans-locked" | "cap";

export function addCardTarget(activeCount: number, ent: Entitlement): AddCardTarget {
  if (ent.plan === "expired") return "plans-locked";
  if (activeCount < ent.slotLimit) return "intro";
  // At the plan's limit. Ultra has nothing above it: the part-ways message instead.
  return ent.plan === "ultra" ? "cap" : "plans-newally";
}

/** Spec §8.2: a round-two gender panel with an empty pool is inert and unselectable. Pure. */
export function genderPanelInert(isRound2: boolean, poolSize: number): boolean {
  return isRound2 && poolSize === 0;
}
