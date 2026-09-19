/** Spec §8.4: the add-card state table, evaluated in order. Pure. */

import { MAX_COMPANIONS } from "@/lib/config";

export type AddCardKind = "add" | "cap" | "exhausted";

export function addCardState(activeCount: number, bothPoolsEmpty: boolean): AddCardKind {
  if (activeCount === MAX_COMPANIONS) return "cap";
  if (bothPoolsEmpty) return "exhausted";
  return "add";
}
