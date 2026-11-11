/**
 * The plans screen's decisions, pure so they can be unit-tested: what each entry
 * point (`?from=`) says, which tier it pre-selects, and what the CTA reads.
 */

import { PLAN_CONFIG, TIER_ORDER, type PlanId } from "@/lib/config";
import { COPY, fill } from "@/lib/copy";
import { isPaid, trialDaysLeft } from "@/lib/entitlement";
import type { Entitlement } from "@/state/schema";

export type PlansFrom = "trial" | "chats" | "locked" | "newally" | "deep" | "settings";

export const PLANS_FROMS: readonly PlansFrom[] = ["trial", "chats", "locked", "newally", "deep", "settings"];

/** An unknown or missing `from` behaves like the settings entry. */
export function parseFrom(v: string | null | undefined): PlansFrom {
  return PLANS_FROMS.includes(v as PlansFrom) ? (v as PlansFrom) : "settings";
}

export interface PlansView {
  head: string;
  sub: string;
  /** The tier that starts selected. */
  pick: PlanId;
  meter: { pct: number; text: string } | null;
  /** The X in the corner. Hidden when the plan is the only way forward. */
  showClose: boolean;
  /** The text link under the cards. */
  later: "maybeLater" | "readChats" | null;
}

const BASE_PICK: Record<PlansFrom, PlanId> = { trial: "pro", chats: "pro", locked: "pro", newally: "max", deep: "ultra", settings: "pro" };

/** The tier above `id`, or `id` itself at the top. */
function tierAbove(id: PlanId): PlanId {
  return TIER_ORDER[Math.min(TIER_ORDER.length - 1, TIER_ORDER.indexOf(id) + 1)];
}

/** The tier a screen opens on: the entry point's choice, or for a subscriber, their own plan (settings) or the next one up. */
export function pickTier(from: PlansFrom, ent: Entitlement): PlanId {
  const base = BASE_PICK[from];
  if (!isPaid(ent.plan)) return base;
  if (from === "settings") return ent.plan;
  // Never pre-select a tier the subscriber already has, or one below it.
  return TIER_ORDER.indexOf(base) <= TIER_ORDER.indexOf(ent.plan) ? tierAbove(ent.plan) : base;
}

export function plansView(from: PlansFrom, ent: Entitlement): PlansView {
  const P = COPY.plans;
  const total = PLAN_CONFIG.trialDays;
  const dailyTotal = PLAN_CONFIG.trial.dailyChats;
  const subscribed = isPaid(ent.plan);
  const pick = pickTier(from, ent);
  const dismiss = { showClose: true, later: "maybeLater" as const };

  switch (from) {
    case "trial": {
      const left = trialDaysLeft(ent);
      const day = Math.min(total, Math.max(1, ent.trialDay ?? 1));
      return {
        head: left <= 0 ? P.trialHeadLast : left === 1 ? P.trialHeadOne : fill(P.trialHead, { n: left }),
        sub: P.trialSub,
        pick,
        meter: { pct: Math.round((day / total) * 100), text: fill(P.meterTrial, { day, total }) },
        ...dismiss,
      };
    }
    case "chats": {
      const n = Math.max(0, Math.min(dailyTotal, ent.chatsLeftToday ?? 0));
      return {
        head: n === 0 ? P.chatsHeadZero : n === 1 ? P.chatsHeadOne : fill(P.chatsHead, { n }),
        sub: P.chatsSub,
        pick,
        meter: { pct: Math.round(((dailyTotal - n) / dailyTotal) * 100), text: fill(P.meterChats, { n, total: dailyTotal }) },
        ...dismiss,
      };
    }
    case "locked":
      return { head: P.lockedHead, sub: P.lockedSub, pick, meter: null, showClose: false, later: "readChats" };
    case "newally":
      return { head: P.newallyHead, sub: P.newallySub, pick, meter: null, ...dismiss };
    case "deep":
      return { head: P.deepHead, sub: P.deepSub, pick, meter: null, ...dismiss };
    case "settings":
      return { head: subscribed ? P.subscribedHead : P.settingsHead, sub: P.settingsSub, pick, meter: null, ...dismiss };
  }
}

export interface CtaState {
  label: string;
  disabled: boolean;
}

/**
 * What the sticky button says for the selected tier. A subscriber sees "Current plan" (disabled)
 * on their own tier and "Switch to {Tier}" on the others. In a browser, with no purchase sheet to
 * open, it sends people to the Play Store listing instead.
 */
export function ctaState(sel: PlanId, ent: Entitlement, prices: Record<PlanId, string>, webFlow: boolean): CtaState {
  const tier = PLAN_CONFIG.tiers[sel];
  const current = isPaid(ent.plan) ? ent.plan : null;
  if (current === sel) return { label: COPY.plans.ctaCurrent, disabled: true };
  if (webFlow) return { label: COPY.plans.ctaWeb, disabled: false };
  if (current) return { label: fill(COPY.plans.ctaSwitch, { tier: tier.name }), disabled: false };
  return { label: fill(COPY.plans.ctaContinue, { tier: tier.name, price: prices[sel] }), disabled: false };
}

/** An Ultra user with every slot full has nothing to buy: the plans screen shows the part-ways message instead. */
export function ultraFull(from: PlansFrom, ent: Entitlement, activeCount: number): boolean {
  return from === "newally" && ent.plan === "ultra" && activeCount >= ent.slotLimit;
}

/** The Settings "Plan" row's value: the plan name, the days left on the trial, or "No active plan". */
export function planRowText(e: Entitlement): string {
  if (e.plan === "expired") return COPY.settings.planNone;
  if (e.plan !== "trial") return PLAN_CONFIG.tiers[e.plan].name;
  const n = trialDaysLeft(e);
  if (n <= 0) return COPY.settings.planTrialLast;
  if (n === 1) return COPY.settings.planTrialOne;
  return fill(COPY.settings.planTrial, { n });
}
