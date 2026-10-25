import type { CoreId } from "@/state/schema";
import { LIVE_TEMPLATES, brainOf } from "@/personas/registry";

/**
 * D1: the one place that decides which companions talk to a live model.
 * Mirrored in SQL by ally_private.is_live(). Every other companion keeps
 * replyFor() and receive_reply. A companion is live only when its own primary
 * core is its face's brain, and a "qa" template is live only when the
 * companion's owner has profile role admin or qa.
 */
export function isLive(companion: { templateId: string; core: { primary: CoreId | null } }, ownerIsQa: boolean): boolean {
  const audience = (LIVE_TEMPLATES as Record<string, string>)[companion.templateId];
  if (!audience || companion.core.primary !== brainOf(companion.templateId)) return false;
  return audience === "all" || (audience === "qa" && ownerIsQa);
}
