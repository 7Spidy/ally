/**
 * Casting sheet v7: which cores each face can serve. A face belongs to a
 * core's deck when its primary or secondary core matches. Never shown to
 * the user.
 */

import type { CoreId } from "@/state/schema";

/** Primary then secondary (`null` = none). */
export const CORE_MAP: Record<string, [CoreId, CoreId | null]> = {
  F01: ["ROMANTIC", "MONEY"], F02: ["ROMANTIC", "PSYCH"], F03: ["ROMANTIC", "TRAINER"], F04: ["PSYCH", null],
  F05: ["ROMANTIC", "FRIEND"], F06: ["ROMANTIC", "TRAINER"], F07: ["PSYCH", null], F08: ["TRAINER", null],
  F09: ["FRIEND", null], F10: ["ROMANTIC", "TRAINER"], F11: ["MONEY", null], F12: ["FRIEND", null],
  F13: ["MONEY", "FRIEND"], F14: ["ROMANTIC", null], F15: ["ROMANTIC", "PSYCH"], F16: ["ROMANTIC", "MONEY"],
  M01: ["ROMANTIC", "MONEY"], M02: ["ROMANTIC", "MONEY"], M03: ["ROMANTIC", "FRIEND"], M04: ["ROMANTIC", "PSYCH"],
  M05: ["ROMANTIC", "MONEY"], M06: ["MONEY", null], M07: ["ROMANTIC", "FRIEND"], M08: ["TRAINER", null],
  M09: ["TRAINER", "PSYCH"], M10: ["FRIEND", null], M11: ["PSYCH", null], M12: ["ROMANTIC", "TRAINER"],
  M13: ["PSYCH", null], M14: ["ROMANTIC", null], M15: ["FRIEND", "TRAINER"], M16: ["ROMANTIC", null],
};

/** Hide a face from these core decks even though the map lists it (F01's Money brain does not exist yet). */
export const DECK_HIDDEN: Record<string, CoreId[]> = { F01: ["MONEY"] };

export function castsAs(id: string, core: CoreId): boolean {
  const entry = CORE_MAP[id];
  if (!entry) return false;
  return entry[0] === core || entry[1] === core;
}
