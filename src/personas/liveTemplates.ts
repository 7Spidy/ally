import { CORE_MAP } from "@/lib/coreMap";
import type { CoreId } from "@/state/schema";

/** Who may talk to the live model: everyone, or only accounts with role admin or qa. Mirrored in SQL by ally_private.live_faces(). */
export const LIVE_TEMPLATES = { F01: "all", F02: "all", F03: "all", F04: "all", F05: "all", F06: "all", F07: "all", F08: "all", F09: "all", F10: "all", F11: "all", F12: "all", F13: "all", F14: "all", F15: "all", F16: "all", M01: "all", M02: "all", M03: "all", M04: "all", M05: "all", M06: "all", M07: "all", M08: "all", M09: "all", M10: "all", M11: "all", M12: "all", M13: "all", M14: "all", M15: "all", M16: "all" } as const;

export type LiveAudience = (typeof LIVE_TEMPLATES)[keyof typeof LIVE_TEMPLATES];

/** A face's brain is its primary core in CORE_MAP (D1). Throws on an unknown template. */
export function brainOf(templateId: string): CoreId {
  const entry = CORE_MAP[templateId];
  if (!entry) throw new Error(`No core for template ${templateId}`);
  return entry[0];
}
