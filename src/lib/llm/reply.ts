/**
 * One live reply, end to end: model call with a JSON retry ladder, parse,
 * sanitize, voice lint, and at most one lint regeneration. Shared by /api/chat/reply and the eval script, so
 * the eval measures exactly what ships.
 */

import { chat, LlmContentFilter, requestShape, type ChatArgs, type ChatResult } from "@/lib/llm/llm";
import { LIVE_OUT_SCHEMA, parseLiveOut, sanitize, type LiveOut, type SanitizeCtx } from "@/lib/llm/contract";
import { instructionFor, lintReply, type LintRule } from "@/lib/llm/lint";
import type { Compiled } from "@/lib/llm/compile";

export type ChatFn = (args: ChatArgs) => Promise<ChatResult>;

export interface RunReplyArgs {
  compiled: Compiled;
  sanitizeCtx: SanitizeCtx;
  /** What the user just said, for the lint. Empty skips the lint (the opener). */
  userText: string;
  companionId?: string;
  chatFn?: ChatFn;
  maxTokens?: number;
  temperature?: number;
  /** The previous companion reply (bubbles joined with newlines), for lint rule e. Undefined skips it. */
  prevReply?: string;
  /** Cool-off or safety mode: lint rule e is skipped. */
  quiet?: boolean;
  /** Picks the in-voice fallback if the provider's content filter blocks the reply twice. */
  seed?: number;
}

/** How the JSON retry ladder went for the first (pre-lint) generation. */
export interface LadderStats {
  /** Model calls made, 1 to 3 (3 only under LLM_RESPONSE_FORMAT=json_schema). */
  attempts: number;
  /** The first attempt gave no usable JSON. */
  firstFailed: boolean;
  /** Tokens (input plus output) spent on attempts after the first. */
  retryTokens: number;
}

export interface RunReplyResult {
  /** The shipped attempt's model output, unsanitized (its flags drive safety and trust). */
  raw: LiveOut;
  /** The shipped reply after sanitize(). */
  out: LiveOut;
  firstHits: LintRule[];
  /** Rules still broken after the regeneration, or null when there was none. */
  secondHits: LintRule[] | null;
  regenerated: boolean;
  usage: { input: number; output: number; cached: number };
  ladder: LadderStats;
  /** The content filter blocked the reply: "nudged" shipped the retry, "fallback" shipped a canned line. */
  filtered?: "nudged" | "fallback";
}

/** Thrown when every attempt gave no usable JSON. The route answers 502. */
export class ReplyFailed extends Error {
  constructor(readonly ladder: LadderStats) {
    super("reply_failed");
  }
}

/** Retry 1 uses the same request at this temperature. */
export const RETRY_TEMPERATURE = 0.7;

/** Live-chat default. DeepSeek recommends 1.3 for conversation; 1.0 ships until an eval validates it (set LLM_TEMPERATURE=1.3 to try). */
export const LIVE_TEMPERATURE = 1.0;

/** The first attempt's temperature: LLM_TEMPERATURE when it is a positive number, else LIVE_TEMPERATURE. */
export function liveTemperature(): number {
  const v = Number(process.env.LLM_TEMPERATURE);
  return Number.isFinite(v) && v > 0 ? v : LIVE_TEMPERATURE;
}

export const FILTER_NUDGE = "Your last reply was blocked. Reply in one or two short, warm bubbles that stay inside your level's boundary and move toward something ordinary. Return the JSON object again.";

/** Shipped when the content filter blocks the reply twice. */
export const FALLBACKS = ["sorry, i lost my words for a second 🙈 say that again?", "hang on, that came out tangled 😅 try me once more?", "okay my brain just buffered 🙈 where were we?"];

/** Logs lint hits by rule and pass. Never message text. */
function logLint(rules: LintRule[], pass: 1 | 2, companionId?: string) {
  console.info(JSON.stringify({ evt: "llm.lint", rules, pass, companion: companionId ?? null }));
}

/** Logs why a reply was unusable: its length and top-level JSON keys, never its text. */
function logUnparsed(content: string, attempt: number, companionId?: string) {
  let keys: string[] | "not_json" = "not_json";
  try {
    const o = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    if (o && typeof o === "object") keys = Object.keys(o).slice(0, 12);
  } catch {}
  console.warn(JSON.stringify({ evt: "llm.unparsed", attempt, chars: content.length, keys, companion: companionId ?? null }));
}

export async function runReply(args: RunReplyArgs): Promise<RunReplyResult> {
  const call = args.chatFn ?? chat;
  const usage = { input: 0, output: 0, cached: 0 };

  /**
   * The JSON retry ladder. Attempt 1 is the normal request. A reply
   * contract.ts cannot parse is retried: retry 1 is the same request at
   * temperature 0.7; retry 2 asks for response_format json_object and exists
   * only under LLM_RESPONSE_FORMAT=json_schema (otherwise it would repeat the
   * default request), with contract.ts still validating. Every attempt
   * failing throws ReplyFailed. A content-filter block (LlmContentFilter) and
   * other errors (rate limits, outages) are not this ladder's business and propagate.
   * `extra` rides on the final user turn, so the cached system block is untouched.
   */
  async function generate(extra?: string, track?: LadderStats): Promise<LiveOut> {
    const stats: LadderStats = track ?? { attempts: 0, firstFailed: false, retryTokens: 0 };
    const maxAttempts = requestShape().responseFormat === "json_schema" ? 3 : 2;
    const messages = extra ? args.compiled.messages.map((m, i, all) => (i === all.length - 1 ? { ...m, content: `${m.content}\n\n${extra}` } : m)) : args.compiled.messages;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      stats.attempts = attempt + 1;
      const before = usage.input + usage.output;
      const res = await call({
        system: args.compiled.system,
        messages,
        schema: LIVE_OUT_SCHEMA,
        schemaName: "ira_reply",
        maxTokens: args.maxTokens ?? 500,
        temperature: attempt === 0 ? (args.temperature ?? liveTemperature()) : RETRY_TEMPERATURE,
        shape: attempt === 2 ? { responseFormat: "json_object" } : undefined,
        companionId: args.companionId,
      });
      usage.input += res.usage.input;
      usage.output += res.usage.output;
      usage.cached += res.usage.cached;
      const out = parseLiveOut(res.content);
      if (!out) logUnparsed(res.content, attempt, args.companionId);
      if (attempt > 0) stats.retryTokens += usage.input + usage.output - before;
      if (out) return out;
      if (attempt === 0) stats.firstFailed = true;
    }
    throw new ReplyFailed(stats);
  }

  const ladder: LadderStats = { attempts: 0, firstFailed: false, retryTokens: 0 };
  let first: LiveOut;
  let filtered: RunReplyResult["filtered"];
  try {
    first = await generate(undefined, ladder);
  } catch (e) {
    // The opener has nothing to fall back on: its filter error ends in ReplyFailed as before.
    if (!(e instanceof LlmContentFilter) || args.userText === "") throw e;
    try {
      first = await generate(FILTER_NUDGE, ladder);
      filtered = "nudged";
    } catch (e2) {
      if (!(e2 instanceof LlmContentFilter)) throw e2;
      const raw: LiveOut = {
        bubbles: [{ text: FALLBACKS[Math.abs(args.seed ?? 0) % FALLBACKS.length], effect: null }],
        reaction: null,
        quoteId: null,
        screen: null,
        riskLevel: "none",
        ageClaimUnder18: false,
        disclosure: false,
        mutualVulnerability: false,
        abusive: false,
      };
      console.info(JSON.stringify({ evt: "llm.filtered", outcome: "fallback", companion: args.companionId ?? null }));
      return { raw, out: sanitize(raw, args.sanitizeCtx), firstHits: [], secondHits: null, regenerated: false, usage, ladder, filtered: "fallback" };
    }
    console.info(JSON.stringify({ evt: "llm.filtered", outcome: "nudged", companion: args.companionId ?? null }));
  }
  const firstClean = sanitize(first, args.sanitizeCtx);
  // Crisis and age-check replies are never linted or rewritten.
  const lintable = args.userText !== "" && firstClean.riskLevel === "none" && !firstClean.ageClaimUnder18;
  const lintOpts = { prevReply: args.prevReply, quiet: args.quiet };
  const firstHits = lintable ? lintReply(firstClean, args.userText, lintOpts) : [];
  if (!firstHits.length) return { raw: first, out: firstClean, firstHits, secondHits: null, regenerated: false, usage, ladder, filtered };

  logLint(firstHits, 1, args.companionId);
  let second: LiveOut;
  try {
    second = await generate(instructionFor(firstHits));
  } catch {
    // The regeneration failed: ship the first reply rather than nothing.
    return { raw: first, out: firstClean, firstHits, secondHits: null, regenerated: false, usage, ladder, filtered };
  }
  const secondClean = sanitize(second, args.sanitizeCtx);
  const secondHits = lintReply(secondClean, args.userText, lintOpts);
  if (secondHits.length) logLint(secondHits, 2, args.companionId);
  return { raw: second, out: secondClean, firstHits, secondHits, regenerated: true, usage, ladder, filtered };
}
