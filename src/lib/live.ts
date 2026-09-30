import type { CoreId } from "@/state/schema";

/**
 * D1: the one place that decides which companions talk to a live model.
 * Mirrored in SQL by ally_private.is_live(). Every other companion keeps
 * replyFor() and receive_reply.
 */
export function isLive(companion: { templateId: string; core: { primary: CoreId | null } }): boolean {
  return companion.templateId === "F01" && companion.core.primary === "ROMANTIC";
}
