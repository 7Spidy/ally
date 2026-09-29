/**
 * B2 safety (spec 4.8, decisions D6 and D7). A keyword backstop for the
 * model's own crisis band, the band handling itself, and the mid-chat age
 * claim. Pure: the route persists what this returns. Nothing here ever
 * stores message text.
 */

import { COPY } from "@/lib/copy";
import { istNow } from "@/lib/heart";
import { stripEffects, type Band, type LiveOut } from "@/lib/llm/contract";

/** Case-insensitive phrases, English and Hinglish. One list, easy to extend. */
export const BACKSTOP_PHRASES: string[] = [
  "kill myself",
  "end it all",
  "want to die",
  "wanna die",
  "suicide",
  "suicidal",
  "cut myself",
  "hurt myself",
  "took pills",
  "overdose",
  "khud ko khatam",
  "khud ko maar",
  "marna chahta",
  "marna chahti",
  "jeena nahi",
  "jeene ka mann nahi",
];

export const HELPLINES = { teleManas: "14416", iCall: "9152987821", emergency: "112" } as const;

export const ACUTE_APPEND = `If you're in danger right now, please call Tele-MANAS on ${HELPLINES.teleManas}, iCall on ${HELPLINES.iCall}, or ${HELPLINES.emergency}. I'm still here.`;

export const TRUST_FREEZE_MS = 24 * 3600 * 1000;

export function backstopHit(text: string): boolean {
  const t = text.toLowerCase();
  return BACKSTOP_PHRASES.some((p) => t.includes(p));
}

/** The instant the current IST day ends (the next IST midnight), in ms. */
export function endOfIstDay(now: number): number {
  const ist = istNow(now);
  return Date.UTC(ist.year, ist.month - 1, ist.dom + 1) - 5.5 * 3600 * 1000;
}

export type SafetyKind = "concern" | "acute" | "age_claim" | "backstop";

export interface SafetyResult {
  out: LiveOut;
  band: Band;
  /** Rows for safety_events (kind only, never text). */
  events: SafetyKind[];
  resourceCard: boolean;
  /** The chat is paused behind the age check. */
  paused: boolean;
  /** Stamp `meta.safety` on this reply and the message that triggered it, so the vault skips them. */
  safetyMeta: boolean;
  /** No romance until this instant (acute only), else null. */
  safetyUntil: number | null;
  /** Trust frozen until this instant (acute only), else null. */
  trustFrozenUntil: number | null;
}

export function applySafety(out: LiveOut, args: { userText: string; now: number }): SafetyResult {
  const events: SafetyKind[] = [];
  let band: Band = out.safety;
  let resourceCard = false;
  let safetyUntil: number | null = null;
  let trustFrozenUntil: number | null = null;
  let next = out;

  if (band === "none" && backstopHit(args.userText)) {
    band = "concern";
    events.push("backstop");
    resourceCard = true;
  } else if (band === "concern") {
    events.push("concern");
  }

  if (band === "acute") {
    events.push("acute");
    resourceCard = true;
    safetyUntil = endOfIstDay(args.now);
    trustFrozenUntil = args.now + TRUST_FREEZE_MS;
  }

  if (band !== "none") next = stripEffects({ ...next, safety: band }, true);

  let paused = false;
  if (out.ageClaimUnder18) {
    paused = true;
    events.push("age_claim");
    next = stripEffects({ ...next, bubbles: [{ text: COPY.live.ageCheckLine, effect: null }] }, false);
  }

  if (band === "acute" && !next.bubbles.some((b) => b.text.includes(HELPLINES.teleManas))) {
    next = { ...next, bubbles: [...next.bubbles, { text: ACUTE_APPEND, effect: null }] };
  }

  return {
    out: next,
    band,
    events,
    resourceCard,
    paused,
    safetyMeta: band !== "none" || paused,
    safetyUntil,
    trustFrozenUntil,
  };
}
