/**
 * One live reply, end to end: model call with a JSON retry ladder, parse,
 * sanitize, voice lint, and at most one lint regeneration. Shared by /api/chat/reply and the eval script, so
 * the eval measures exactly what ships.
 */

import { chat, XaiError, type ChatArgs, type ChatResult } from "@/lib/llm/xai";
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
}

/** How the JSON retry ladder went for the first (pre-lint) generation. */
export interface LadderStats {
  /** Model calls made, 1 to 3. */
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
}

/** Thrown when all three attempts gave no usable JSON. The route answers 502. */
export class ReplyFailed extends Error {
  constructor(readonly ladder: LadderStats) {
    super("reply_failed");
  }
}

/** Retry 1 uses the same request at this temperature. */
export const RETRY_TEMPERATURE = 0.7;

/** A provider 400 that means "the model's output failed JSON validation". */
export function isJsonValidateFailure(e: unknown): boolean {
  return e instanceof XaiError && e.status === 400 && /json_validate_failed/.test(e.body ?? "");
}

/** Logs lint hits by rule and pass. Never message text. */
function logLint(rules: LintRule[], pass: 1 | 2, companionId?: string) {
  console.info(JSON.stringify({ evt: "llm.lint", rules, pass, companion: companionId ?? null }));
}

export async function runReply(args: RunReplyArgs): Promise<RunReplyResult> {
  const call = args.chatFn ?? chat;
  const usage = { input: 0, output: 0, cached: 0 };

  /**
   * The JSON retry ladder. Attempt 1 is the normal request. A provider
   * json_validate_failed 400 or a reply contract.ts cannot parse is retried:
   * retry 1 is the same request at temperature 0.7; retry 2 asks for
   * response_format json_object, with contract.ts still validating. All three
   * failing throws ReplyFailed. Other errors (rate limits, outages) are not
   * this ladder's business and propagate.
   */
  async function generate(extra?: string, track?: LadderStats): Promise<LiveOut> {
    const stats: LadderStats = track ?? { attempts: 0, firstFailed: false, retryTokens: 0 };
    for (let attempt = 0; attempt < 3; attempt++) {
      stats.attempts = attempt + 1;
      const before = usage.input + usage.output;
      let out: LiveOut | null = null;
      try {
        const res = await call({
          system: extra ? `${args.compiled.system}\n\n${extra}` : args.compiled.system,
          messages: args.compiled.messages,
          schema: LIVE_OUT_SCHEMA,
          schemaName: "ira_reply",
          maxTokens: args.maxTokens ?? 500,
          temperature: attempt === 0 ? (args.temperature ?? 0.8) : RETRY_TEMPERATURE,
          shape: attempt === 2 ? { responseFormat: "json_object" } : undefined,
          companionId: args.companionId,
        });
        usage.input += res.usage.input;
        usage.output += res.usage.output;
        usage.cached += res.usage.cached;
        out = parseLiveOut(res.content);
      } catch (e) {
        if (!isJsonValidateFailure(e)) throw e;
      }
      if (attempt > 0) stats.retryTokens += usage.input + usage.output - before;
      if (out) return out;
      if (attempt === 0) stats.firstFailed = true;
    }
    throw new ReplyFailed(stats);
  }

  const ladder: LadderStats = { attempts: 0, firstFailed: false, retryTokens: 0 };
  const first = await generate(undefined, ladder);
  const firstClean = sanitize(first, args.sanitizeCtx);
  // Crisis and age-check replies are never linted or rewritten.
  const lintable = args.userText !== "" && firstClean.riskLevel === "none" && !firstClean.ageClaimUnder18;
  const firstHits = lintable ? lintReply(firstClean, args.userText) : [];
  if (!firstHits.length) return { raw: first, out: firstClean, firstHits, secondHits: null, regenerated: false, usage, ladder };

  logLint(firstHits, 1, args.companionId);
  let second: LiveOut;
  try {
    second = await generate(instructionFor(firstHits));
  } catch {
    // The regeneration failed: ship the first reply rather than nothing.
    return { raw: first, out: firstClean, firstHits, secondHits: null, regenerated: false, usage, ladder };
  }
  const secondClean = sanitize(second, args.sanitizeCtx);
  const secondHits = lintReply(secondClean, args.userText);
  if (secondHits.length) logLint(secondHits, 2, args.companionId);
  return { raw: second, out: secondClean, firstHits, secondHits, regenerated: true, usage, ladder };
}
