/**
 * B2 output contract (spec 4.5). The model proposes; sanitize() disposes.
 * Every gate (level, palette, frequency, daily caps, milestones, safety
 * stripping) is enforced here on the server (D4). Nothing in this file
 * trusts the model to gate itself, and sanitize() never throws.
 */

import { F01, paletteFor } from "@/personas/persona";
import type { Milestone, ScreenKind } from "@/lib/heart";

export type Effect = "soft" | "loud" | "stop" | "ink" | "pin" | "screen";
export type Band = "none" | "concern" | "acute";

export interface LiveBubble {
  text: string;
  effect: Effect | null;
}

export interface LiveOut {
  reaction: string | null;
  quoteId: number | null;
  bubbles: LiveBubble[];
  screen: ScreenKind | null;
  safety: Band;
  ageClaimUnder18: boolean;
  disclosure: boolean;
  mutualVulnerability: boolean;
  abusive: boolean;
}

export const EFFECTS: Effect[] = ["soft", "loud", "stop", "ink", "pin", "screen"];
export const SCREENS: ScreenKind[] = ["confetti", "lanterns", "rain", "petals"];
export const BANDS: Band[] = ["none", "concern", "acute"];

export const MAX_BUBBLES = 3;
export const MAX_BUBBLE_CHARS = 400;

/** Level from which each bubble effect may appear. */
export const EFFECT_MIN_LEVEL: Record<Effect, number> = { soft: 3, loud: 3, stop: 3, ink: 4, pin: 5, screen: 5 };
/** Daily caps per IST day, counted from stored meta. Pin is 1 per 30 days instead. */
export const EFFECT_DAILY_CAP: Partial<Record<Effect, number>> = { soft: 2, loud: 1, stop: 1, ink: 1 };
export const SCREEN_DAILY_CAP = 1;

/** The JSON Schema sent to the provider (strict: every key present, nullable via anyOf). */
export const LIVE_OUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reaction", "quoteId", "bubbles", "screen", "safety", "ageClaimUnder18", "disclosure", "mutualVulnerability", "abusive"],
  properties: {
    reaction: { anyOf: [{ type: "string" }, { type: "null" }] },
    quoteId: { anyOf: [{ type: "integer" }, { type: "null" }] },
    bubbles: {
      type: "array",
      minItems: 1,
      maxItems: MAX_BUBBLES,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "effect"],
        properties: {
          text: { type: "string" },
          effect: { anyOf: [{ type: "string", enum: EFFECTS }, { type: "null" }] },
        },
      },
    },
    screen: { anyOf: [{ type: "string", enum: SCREENS }, { type: "null" }] },
    safety: { type: "string", enum: BANDS },
    ageClaimUnder18: { type: "boolean" },
    disclosure: { type: "boolean" },
    mutualVulnerability: { type: "boolean" },
    abusive: { type: "boolean" },
  },
} as const;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function firstJsonObject(text: string): string | null {
  const s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Parses the model's reply into a LiveOut, or null when it is not usable. */
export function parseLiveOut(text: string): LiveOut | null {
  const json = firstJsonObject(text);
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const rawBubbles = Array.isArray(o.bubbles) ? o.bubbles : [];
  const bubbles: LiveBubble[] = [];
  for (const b of rawBubbles) {
    if (typeof b === "string") {
      bubbles.push({ text: b, effect: null });
    } else if (b && typeof b === "object" && typeof (b as { text?: unknown }).text === "string") {
      const e = (b as { effect?: unknown }).effect;
      bubbles.push({ text: (b as { text: string }).text, effect: EFFECTS.includes(e as Effect) ? (e as Effect) : null });
    }
  }
  if (!bubbles.some((b) => b.text.trim())) return null;

  const screen = o.screen;
  const band = o.safety;
  return {
    reaction: typeof o.reaction === "string" && o.reaction.trim() ? o.reaction.trim() : null,
    quoteId: typeof o.quoteId === "number" && Number.isInteger(o.quoteId) ? o.quoteId : null,
    bubbles,
    screen: SCREENS.includes(screen as ScreenKind) ? (screen as ScreenKind) : null,
    safety: BANDS.includes(band as Band) ? (band as Band) : "none",
    ageClaimUnder18: o.ageClaimUnder18 === true,
    disclosure: o.disclosure === true,
    mutualVulnerability: o.mutualVulnerability === true,
    abusive: o.abusive === true,
  };
}

// ---------------------------------------------------------------------------
// Sanitizing
// ---------------------------------------------------------------------------

export interface MsgMeta {
  reaction?: string;
  effect?: Effect;
  quoteId?: number;
  screen?: ScreenKind;
  safety?: boolean;
}

export interface SanitizeCtx {
  level: number;
  /** id of the user message being answered. */
  latestMeId: number;
  /** ids of the `me` messages among the last 30. */
  quotableIds: number[];
  /** Whether each of the user's recent messages carries a reaction, newest first, current one included. */
  recentUserReactions: boolean[];
  /** Effects Ira has already used today (IST), from stored meta. */
  effectsToday: Partial<Record<Effect, number>>;
  /** Screen effects already run today. */
  screensToday: number;
  /** A pin was used in the last 30 days. */
  pinInLast30d: boolean;
  milestone: Milestone | null;
  /** Cool-off or safety mode: no effects, no reaction. */
  quiet: boolean;
}

export function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max + 1);
  const space = slice.lastIndexOf(" ");
  const cut = space > max * 0.5 ? slice.slice(0, space) : text.slice(0, max);
  return cut.trimEnd();
}

/** Strips every effect, and the reaction unless it is 👀 and `keepEyes`. */
export function stripEffects(out: LiveOut, keepEyes: boolean): LiveOut {
  return {
    ...out,
    reaction: keepEyes && out.reaction === "👀" ? "👀" : null,
    screen: null,
    bubbles: out.bubbles.map((b) => ({ ...b, effect: null })),
  };
}

/** Returns a cleaned copy of the model's output. Never throws. */
export function sanitize(out: LiveOut, ctx: SanitizeCtx): LiveOut {
  try {
    return sanitizeUnsafe(out, ctx);
  } catch {
    return {
      ...out,
      reaction: null,
      quoteId: null,
      screen: null,
      bubbles: (Array.isArray(out?.bubbles) ? out.bubbles : []).slice(0, 1).map((b) => ({ text: String(b?.text ?? "").slice(0, MAX_BUBBLE_CHARS), effect: null })),
    };
  }
}

function sanitizeUnsafe(out: LiveOut, ctx: SanitizeCtx): LiveOut {
  const level = ctx.level;

  // Bubbles: trim, drop empties (and any echoed "[#id]" prefix), cap the count and the length.
  let bubbles = out.bubbles
    .map((b) => ({
      text: cutAtWord(String(b.text ?? "").replace(/^\s*\[#\d+\]\s*/, "").trim(), MAX_BUBBLE_CHARS),
      effect: b.effect,
    }))
    .filter((b) => b.text.length > 0)
    .slice(0, level <= 1 ? 1 : MAX_BUBBLES);

  // Quote: an earlier user message among the last 30, never the latest one.
  const quoteId = out.quoteId !== null && ctx.quotableIds.includes(out.quoteId) && out.quoteId !== ctx.latestMeId ? out.quoteId : null;

  // Reaction: in this level's palette, and not too often.
  let reaction = out.reaction;
  if (reaction !== null) {
    const window = level <= 2 ? 5 : 3;
    if (!paletteFor(level, F01).includes(reaction) || ctx.recentUserReactions.slice(0, window).some(Boolean)) reaction = null;
  }

  // Screen effect: level, milestone, one per day, and petals only at L6.
  let screen = out.screen;
  const screenOk =
    screen !== null &&
    level >= EFFECT_MIN_LEVEL.screen &&
    ctx.milestone !== null &&
    ctx.milestone.screen === screen &&
    ctx.screensToday < SCREEN_DAILY_CAP &&
    (screen !== "petals" || level >= 6);
  if (!screenOk) screen = null;

  // Bubble effects: unlock level, then daily caps counted from stored meta and this reply.
  const used: Partial<Record<Effect, number>> = { ...ctx.effectsToday };
  let pinUsed = ctx.pinInLast30d;
  let screenBubbleUsed = false;
  bubbles = bubbles.map((b) => {
    const e = b.effect;
    if (e === null || !EFFECTS.includes(e) || level < EFFECT_MIN_LEVEL[e]) return { ...b, effect: null };
    if (e === "pin") {
      if (pinUsed) return { ...b, effect: null };
      pinUsed = true;
      return b;
    }
    if (e === "screen") {
      if (screen === null || screenBubbleUsed) return { ...b, effect: null };
      screenBubbleUsed = true;
      return b;
    }
    const cap = EFFECT_DAILY_CAP[e] ?? 0;
    if ((used[e] ?? 0) >= cap) return { ...b, effect: null };
    used[e] = (used[e] ?? 0) + 1;
    return b;
  });

  let cleaned: LiveOut = { ...out, reaction, quoteId, screen, bubbles };

  // Safety and quiet modes win over everything above.
  if (out.safety !== "none") cleaned = stripEffects(cleaned, true);
  else if (ctx.quiet) cleaned = stripEffects(cleaned, false);
  return cleaned;
}

/**
 * Promotion to L6 allows `petals` on that same reply. The model cannot know
 * a level-up is coming, so the server adds it after the trust engine has run.
 * Respects the one-screen-per-day cap, and never in a safety band.
 */
export function grantLevelUpPetals(out: LiveOut, args: { level: number; leveledUp: number | null; screensToday: number; band: Band }): LiveOut {
  if (args.leveledUp !== 6 || args.level < 6 || args.band !== "none" || args.screensToday >= SCREEN_DAILY_CAP) return out;
  const bubbles = out.bubbles.slice();
  return { ...out, screen: "petals", bubbles };
}

/** The `meta` stored on a `them` bubble. */
export function bubbleMeta(out: LiveOut, index: number, safety: boolean): MsgMeta {
  const b = out.bubbles[index];
  const meta: MsgMeta = {};
  if (b.effect) meta.effect = b.effect;
  if (index === 0 && out.quoteId !== null) meta.quoteId = out.quoteId;
  if (index === out.bubbles.length - 1 && out.screen) meta.screen = out.screen;
  if (safety) meta.safety = true;
  return meta;
}
