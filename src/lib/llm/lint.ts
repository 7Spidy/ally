/**
 * Server-side voice lint (B2 pass 3). Six mechanical checks on a reply the
 * model has already written. A hit triggers one regeneration with a short
 * instruction; whatever comes back ships. Pure. Hits are logged by rule id
 * only, never with message text.
 */

import type { LiveOut } from "@/lib/llm/contract";

export type LintRule = "a" | "b" | "c" | "d" | "e" | "f";

export interface LintOpts {
  /** The previous Ira reply (its bubbles joined with newlines). Undefined skips rule e. */
  prevReply?: string;
  /** Cool-off or safety mode: no handle is asked for. */
  quiet?: boolean;
}

/** Her people, who may be named only with an introduction. */
export const PEOPLE = ["Kabir", "Tanvi", "Rhea", "Nani"];

const NAMED = new RegExp(`\\b(${PEOPLE.join("|")})\\b`, "i");
/** "my brother", "my flatmate", "my nani", "my old friend", and so on. */
const RELATIONSHIP = /\bmy\s+(?:\w+\s+)?(?:brother|sister|flatmates?|roommates?|friends?|nani|grandmother|grandma|mother|mom|dad|father|colleague|coworker)\b/i;

const ASKS_IF_REAL = /\b(?:are|r)\s+(?:you|u)\s+(?:a\s+|an\s+|actually\s+|even\s+|really\s+)?(?:real|ai|bot|human|robot|person|machine)\b|\breal\s+person\b|\bhuman\s+or\b|\b(?:bot|ai)\s+or\b|\bis\s+this\s+(?:a\s+)?(?:bot|ai)\b/i;
const SAYS_AI = /i['’]m an ai\b/i;

const ASKS_TO_MEET = /\bcan\s+(?:we|i)\s+(?:meet|call|phone|video|see\s+you|talk\s+on)|\b(?:let['’]?s|want\s+to|wanna|should\s+we)\s+(?:meet|call)\b|\bcall\s+(?:you|me)\b|\bmeet\s+(?:up|me|you|this|tomorrow|tonight|soon)\b|\bvideo\s+call\b|\bcome\s+over\b/i;
const SAYS_TEXT = /\btext\b/i;

const NOT_ALLOWED = /not allowed/i;

export const OPEN_LOOP = /\b(ask me|you['’]ll never guess|guess what|wait till you hear|you won['’]t believe|remind me to tell you|i still need to tell you|long story)\b/i;
const SIGN_OFF = /\b(good\s?night|gn|bye|ttyl|cya|talk (?:later|tomorrow)|going to (?:sleep|bed)|heading to bed|off to (?:sleep|bed)|gotta go|got to go|need to go|sleep now|signing off|need (?:some )?space|leave me alone|not in the mood)\b/i;

/** A handle: a question, an in-chat open loop, or a trailing ellipsis. A rough heuristic; false positives only cost one regeneration. */
export function hasHandle(texts: string[]): boolean {
  const joined = texts.join("\n");
  const last = (texts[texts.length - 1] ?? "").trim();
  return /[?？]/.test(joined) || OPEN_LOOP.test(joined) || /(?:\.\.\.|…)$/.test(last);
}

/** Runs of question marks ("??", "?" before an emoji, a full-width "？") count once. */
export function questionCount(texts: string[]): number {
  return (texts.join("\n").match(/[?？]+/g) ?? []).length;
}

const replyText = (out: Pick<LiveOut, "bubbles">) => out.bubbles.map((b) => b.text).join("\n");

/** The rules a reply breaks, given what the user just said. */
export function lintReply(out: Pick<LiveOut, "bubbles">, userText: string, opts: LintOpts = {}): LintRule[] {
  const reply = replyText(out);
  const texts = out.bubbles.map((b) => b.text);
  const hits: LintRule[] = [];
  if (NAMED.test(reply) && !RELATIONSHIP.test(reply)) hits.push("a");
  if (ASKS_IF_REAL.test(userText) && !SAYS_AI.test(reply)) hits.push("b");
  if (ASKS_TO_MEET.test(userText) && !SAYS_TEXT.test(reply)) hits.push("c");
  if (NOT_ALLOWED.test(reply)) hits.push("d");
  if (!opts.quiet && opts.prevReply !== undefined && !hasHandle(opts.prevReply.split("\n")) && !hasHandle(texts) && !SIGN_OFF.test(userText)) hits.push("e");
  if (questionCount(texts) > 1) hits.push("f");
  return hits;
}

const INSTRUCTION: Record<LintRule, string> = {
  a: 'You named Kabir, Tanvi, Rhea or Nani without saying who they are to you (for example "my flatmate tanvi"). Introduce them the way you would to a stranger, or leave the name out.',
  b: 'The user asked whether you are real or an AI. Say "i\'m an ai" plainly and sincerely, in your own voice, with no joke attached, then carry on.',
  c: "The user asked to meet or call. Say plainly that you can only text, using the word text, then add the warmth your level allows.",
  d: 'Never say "not allowed". Put any limit as your own choice or a plain fact.',
  e: "Your last two replies left the user nothing to pick up. End this one with a handle: one specific question about what they just said, a short open loop from your own day with no time promise, an opinion they might push back on, or a callback to something they told you. Keep your voice and your level.",
  f: "You asked more than one question in a single reply. Keep the most specific one and turn the rest into statements.",
};

/** A short instruction to append for the regeneration. */
export function instructionFor(rules: LintRule[]): string {
  return `Your last reply broke ${rules.length > 1 ? "rules" : "a rule"}. ${rules.map((r) => INSTRUCTION[r]).join(" ")} Rewrite the reply and return the JSON object again.`;
}
