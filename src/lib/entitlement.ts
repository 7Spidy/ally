/**
 * Plan and trial helpers. Pure: no DOM, no storage, no Date(). The server is the
 * only judge of what a user may do (get_my_state / send_message); these read
 * the entitlement it sent so the screens agree with what send_message will allow.
 */

import type { Companion, Entitlement } from "@/state/schema";
import { PLAN_CONFIG, type EffectivePlan, type PlanId } from "@/lib/config";

/** The distinct reasons send_message refuses a send (status in its blocked reply). */
export type SendCode = "TRIAL_LIMIT" | "PLAN_EXPIRED" | "FAIR_USE_CAP" | "COMPANION_LOCKED";
export type SendStatus = "ok" | SendCode;

const SEND_CODES: readonly string[] = ["TRIAL_LIMIT", "PLAN_EXPIRED", "FAIR_USE_CAP", "COMPANION_LOCKED"];
export function isSendCode(v: unknown): v is SendCode {
  return typeof v === "string" && SEND_CODES.includes(v);
}

/** The server's snake_case entitlement object. */
export interface RawEntitlement {
  plan: EffectivePlan;
  trial_ends_at: number | null;
  trial_day: number | null;
  slot_limit: number;
  max_level: number;
  can_send: boolean;
  chats_left_today: number | null;
  cap_reached: boolean;
}

export function parseEntitlement(r: RawEntitlement): Entitlement {
  return {
    plan: r.plan,
    trialEndsAt: r.trial_ends_at ?? null,
    trialDay: r.trial_day ?? null,
    slotLimit: r.slot_limit,
    maxLevel: r.max_level,
    canSend: r.can_send,
    chatsLeftToday: r.chats_left_today ?? null,
    capReached: r.cap_reached,
  };
}

export function isPaid(plan: EffectivePlan): plan is PlanId {
  return plan === "pro" || plan === "max" || plan === "ultra";
}

/** The companions that can still take messages: the first `slotLimit` active ones by creation (mirrors ally_private.companion_locked). */
export function lockedCompanionIds(companions: Companion[], slotLimit: number): Set<string> {
  const active = companions
    .filter((c) => c.status === "active")
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Set(active.slice(Math.max(0, slotLimit)).map((c) => c.id));
}

export function activeCount(companions: Companion[]): number {
  return companions.filter((c) => c.status === "active").length;
}

/** Whole days left on the trial after today: day 4 of 7 is 3. 0 on the last day. */
export function trialDaysLeft(e: Entitlement): number {
  if (e.plan !== "trial") return 0;
  return Math.max(0, PLAN_CONFIG.trialDays - (e.trialDay ?? 1));
}

/** What the composer shows. Mirrors the order send_message checks in. */
export type ComposerGate = "normal" | "oneLeft" | "trialLimit" | "expired" | "fairUse" | "locked";

export function composerGate(e: Entitlement, companionLocked: boolean): ComposerGate {
  if (e.plan === "expired") return "expired";
  if (companionLocked) return "locked";
  if (!e.canSend) return e.plan === "trial" ? "trialLimit" : "fairUse";
  if (e.plan === "trial" && e.chatsLeftToday === 1) return "oneLeft";
  return "normal";
}

/** The gate a blocked send_message code maps to. */
export function gateForCode(code: SendCode): ComposerGate {
  switch (code) {
    case "TRIAL_LIMIT":
      return "trialLimit";
    case "PLAN_EXPIRED":
      return "expired";
    case "FAIR_USE_CAP":
      return "fairUse";
    case "COMPANION_LOCKED":
      return "locked";
  }
}

/** True when a new Ally can be started without a plan change. */
export function hasFreeSlot(e: Entitlement, active: number): boolean {
  return active < e.slotLimit;
}
