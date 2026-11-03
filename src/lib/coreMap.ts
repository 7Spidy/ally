/**
 * Casting sheet v7: each face's primary and secondary core. A face belongs to
 * a core's deck only when its PRIMARY core matches, because a face is live
 * (a real brain, no mock reply) only for a user whose matched core equals its
 * primary. The secondary core is texture on the persona, never a way into a
 * deck. Never shown to the user.
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

/** True when the face's primary core is `core`: the only faces that may appear in that core's deck. */
export function servesCore(id: string, core: CoreId): boolean {
  const entry = CORE_MAP[id];
  return !!entry && entry[0] === core;
}
