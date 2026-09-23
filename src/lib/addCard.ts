/** Spec §8.4: the add-card state table, evaluated in order. Pure. */

import { MAX_COMPANIONS } from "@/lib/config";

export type AddCardKind = "add" | "cap" | "exhausted";

export function addCardState(activeCount: number, bothPoolsEmpty: boolean): AddCardKind {
  if (activeCount === MAX_COMPANIONS) return "cap";
  if (bothPoolsEmpty) return "exhausted";
  return "add";
}

/** Spec §8.2: a round-two gender panel with an empty pool is inert and unselectable. Pure. */
export function genderPanelInert(isRound2: boolean, poolSize: number): boolean {
  return isRound2 && poolSize === 0;
}
