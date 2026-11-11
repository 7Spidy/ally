/**
 * Billing hand-off. The Android shell will expose `window.AllyBilling` (Google
 * Play Billing); until then this file is the whole contract between the web app
 * and it. The web app never decides what plan a user is on: a purchase is
 * verified by the server, which calls `set_subscription`, and the app only
 * re-reads its state (get_my_state) afterwards.
 *
 * What the Android shell must provide (all optional, all feature-detected):
 *   window.AllyBilling.launch(productId, basePlanId)  start the Play purchase sheet
 *   window.AllyBilling.restore()                       re-check Play purchases
 *   window.AllyBilling.getPrices()                     localized price strings, by productId
 * and it reports back by calling:
 *   window.onAllyPurchaseResult({ status: 'success' | 'cancelled' | 'error' })
 */

import { PLAN_CONFIG, PLAY_STORE_URL, type PlanId } from "@/lib/config";

export interface AllyBillingBridge {
  launch?: (productId: string, basePlanId: string) => void;
  restore?: () => void | Promise<void>;
  /** Localized price strings keyed by productId, e.g. { ally_pro: "₹299.00" }. May be async. */
  getPrices?: () => Record<string, string> | Promise<Record<string, string>>;
}

export type PurchaseResult = { status: "success" } | { status: "cancelled" } | { status: "error"; message?: string };

declare global {
  interface Window {
    AllyBilling?: AllyBillingBridge;
    onAllyPurchaseResult?: (result: PurchaseResult) => void;
    Capacitor?: { isNativePlatform?: () => boolean };
  }
}

export type SubscriptionOutcome =
  /** The Play purchase sheet was started by the Android shell. */
  | "launched"
  /** Running in a browser: the Play Store listing was opened in a new tab. */
  | "opened_store"
  /** The Android app without a billing bridge yet; nothing to do. */
  | "unavailable";

export function tierProduct(tierId: PlanId): { productId: string; basePlanId: string } {
  const t = PLAN_CONFIG.tiers[tierId];
  return { productId: t.productId, basePlanId: t.basePlanId };
}

/** True inside the Android app (the Capacitor shell), false in a browser. */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** True when the plans screen should send people to the Play Store instead of a purchase sheet. */
export function isWebPurchaseFlow(): boolean {
  if (typeof window === "undefined") return false;
  return !window.AllyBilling?.launch && !isNativeApp();
}

/** Starts a subscription for a tier. See the three branches below. */
export function startSubscription(tierId: PlanId): SubscriptionOutcome {
  const { productId, basePlanId } = tierProduct(tierId);

  // 1. The Android app with Play Billing wired in.
  if (typeof window !== "undefined" && window.AllyBilling?.launch) {
    // TODO(Babu): Android Play Billing integration. launch() should open launchBillingFlow for
    // this productId and basePlanId, then report the outcome through window.onAllyPurchaseResult.
    window.AllyBilling.launch(productId, basePlanId);
    return "launched";
  }

  // 2. A browser: send people to the app's Play Store listing.
  if (typeof window !== "undefined" && !isNativeApp()) {
    window.open(PLAY_STORE_URL, "_blank", "noopener,noreferrer");
    return "opened_store";
  }

  // 3. The Android app before the billing bridge exists.
  // TODO(Babu): Android Play Billing integration. Until AllyBilling.launch is provided there is no purchase to start.
  return "unavailable";
}

/**
 * Asks Play to re-check purchases (the shell then reports through onAllyPurchaseResult),
 * or, with no bridge, simply re-reads the server state, which is the source of truth anyway.
 */
export async function restorePurchases(refetchState: () => Promise<void>): Promise<void> {
  const restore = typeof window !== "undefined" ? window.AllyBilling?.restore : undefined;
  if (restore) {
    // TODO(Babu): Android Play Billing integration. restore() should re-query Play purchases and re-verify them with the server.
    await restore.call(window.AllyBilling);
    return;
  }
  await refetchState();
}

/** Localized price strings from the shell when it can give them, else the configured INR prices. */
export async function loadPrices(): Promise<Record<PlanId, string>> {
  const fallback = Object.fromEntries(
    (Object.keys(PLAN_CONFIG.tiers) as PlanId[]).map((id) => [id, `₹${PLAN_CONFIG.tiers[id].price}`])
  ) as Record<PlanId, string>;
  const getPrices = typeof window !== "undefined" ? window.AllyBilling?.getPrices : undefined;
  if (!getPrices) return fallback;
  try {
    // TODO(Babu): Android Play Billing integration. getPrices() should return Play's formatted price for each productId.
    const byProduct = await getPrices.call(window.AllyBilling);
    const out = { ...fallback };
    for (const id of Object.keys(PLAN_CONFIG.tiers) as PlanId[]) {
      const p = byProduct?.[PLAN_CONFIG.tiers[id].productId];
      if (typeof p === "string" && p.trim()) out[id] = p;
    }
    return out;
  } catch {
    return fallback;
  }
}

export interface PurchaseHandlers {
  /** Called after a success once the state has been re-fetched. */
  onSuccess: () => void;
  onError: () => void;
  /** Re-reads get_my_state. */
  refetchState: () => Promise<void>;
}

/** The pure core of the hook: success re-fetches then goes back, cancelled does nothing, error shows the inline message. */
export async function handlePurchaseResult(result: PurchaseResult, h: PurchaseHandlers): Promise<void> {
  if (result.status === "success") {
    try {
      await h.refetchState();
    } catch {
      /* the next load will catch up; still leave the screen */
    }
    h.onSuccess();
  } else if (result.status === "error") {
    h.onError();
  }
  // "cancelled": nothing.
}

/**
 * Registers window.onAllyPurchaseResult and returns the cleanup, which puts back
 * whatever was registered before (the app-wide default, then the plans screen's).
 * Until the Android shell calls it, it never runs.
 */
export function installPurchaseResultHook(h: PurchaseHandlers): () => void {
  if (typeof window === "undefined") return () => {};
  const prev = window.onAllyPurchaseResult;
  const hook = (result: PurchaseResult) => void handlePurchaseResult(result, h);
  window.onAllyPurchaseResult = hook;
  return () => {
    if (window.onAllyPurchaseResult === hook) window.onAllyPurchaseResult = prev;
  };
}
