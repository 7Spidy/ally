/** Every tunable number in the build. Nothing below is inlined elsewhere. */

export const CHIP_THRESHOLD = 10;
export const PART_PURGE_DAYS = 30;
export const SPLASH_RETURN_MS = 900;
export const LONG_PRESS_MS = 500;
export const BLOCK_DAYS = 180; // under-18 gate: ally_blocked_until = now + BLOCK_DAYS

// P1 accounts and auth
export const CONSENT_VERSION = "2026-09-v1";
/** B2: the consent a user gives once Ira replies live (replies are written by an AI model; the version string is historical and stays). */
export const LIVE_CONSENT_VERSION = "v2-live-groq";
export const OTP_LENGTH = 6;
export const OTP_RESEND_SECONDS = 60;
export const PASSWORD_MIN = 8;
export const DELETE_REAUTH_MINUTES = 10;

// ---------------------------------------------------------------------------
// Plans and trial. The single source of truth for every plan number on the
// client. The SQL side mirrors each value as an `ally_private.<name>()` constant
// (supabase/migrations/20261111000001_plans_and_trial.sql);
// tests/unit/sqlConstants.test.ts fails if either side changes alone.
// ---------------------------------------------------------------------------

export type PlanId = "pro" | "max" | "ultra";
/** What the server says a user is on right now. */
export type EffectivePlan = "trial" | "expired" | PlanId;

export interface TierConfig {
  id: PlanId;
  name: string;
  /** INR a month, GST inclusive. Display only: the price charged comes from Google Play. */
  price: number;
  /** Active Allys at once. */
  slots: number;
  /** Highest trust level the engine uses. */
  maxLevel: number;
  /** Google Play Billing ids. */
  productId: string;
  basePlanId: string;
}

export const PLAN_CONFIG = {
  trialDays: 7,
  trial: { dailyChats: 100, slots: 1, maxLevel: 5 },
  /** The level every plan but Ultra is held to. */
  defaultMaxLevel: 5,
  tiers: {
    pro: { id: "pro", name: "Pro", price: 299, slots: 1, maxLevel: 5, productId: "ally_pro", basePlanId: "monthly" },
    max: { id: "max", name: "Max", price: 499, slots: 2, maxLevel: 5, productId: "ally_max", basePlanId: "monthly" },
    ultra: { id: "ultra", name: "Ultra", price: 799, slots: 4, maxLevel: 6, productId: "ally_ultra", basePlanId: "monthly" },
  } satisfies Record<PlanId, TierConfig>,
} as const;

/** Tier ids in the order the plan picker shows them. */
export const TIER_ORDER: PlanId[] = ["pro", "max", "ultra"];

/**
 * Hidden daily fair-use caps for paid plans. The server enforces them and never
 * sends them to the client; no component imports this, so it stays out of the
 * client bundle. Only the drift test (and the server) read it.
 */
export const HIDDEN_DAILY_CAPS: Record<PlanId, number> = { pro: 300, max: 400, ultra: 400 };

/** The most Allys anyone can have active at once (Ultra). */
export const MAX_COMPANIONS = PLAN_CONFIG.tiers.ultra.slots;

/** The URLs the billing stub and the plans screen open. */
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=in.redream.ally";
export const PLAY_SUBSCRIPTIONS_URL = "https://play.google.com/store/account/subscriptions?package=in.redream.ally";
