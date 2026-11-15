/**
 * The compile() context for one live turn, built from already-fetched rows.
 * Shared by /api/chat/reply and scripts/build_messages.ts so both feed compile()
 * the same shape. Pure: no DB, no clock, no Next imports.
 */

import type { CompileCtx, CompileTurn } from "@/lib/llm/compile";
import type { MsgMeta } from "@/lib/llm/contract";
import type { ReplyPlan } from "@/lib/llm/replyPlan";
import { backstopHit } from "@/lib/safety";
import { wordCount } from "@/lib/trust";
import type { Milestone } from "@/lib/heart";

export interface TurnMsgRow {
  id: number;
  who: "them" | "me";
  text: string;
  meta: MsgMeta | null;
  edited_at?: string | null;
}

export interface TurnCtxInput extends Omit<CompileCtx, "history" | "lowEffort" | "followUp" | "milestone"> {
  milestone: Milestone | null;
  /** Ascending by id. */
  rows: TurnMsgRow[];
  /** Every row that may be quoted, by id (the window plus any quoted from outside it). */
  quotable: Map<number, { who: "them" | "me"; text: string }>;
  plan: ReplyPlan | null;
  /** The text of the user message being answered. */
  userText: string;
}

export function buildTurnCtx(input: TurnCtxInput): { ctx: CompileCtx; allowEmpty: boolean; unansweredTurns: CompileTurn[] } {
  const { rows, quotable, plan, userText, ...rest } = input;
  const quoteFor = (m: TurnMsgRow) => {
    const q = m.who === "me" && typeof m.meta?.quoteId === "number" ? quotable.get(m.meta.quoteId) : undefined;
    return q ? { who: q.who, text: q.text } : null;
  };
  const lastMe = rows.filter((m) => m.who === "me");
  const lowEffort = lastMe.length >= 5 && lastMe.slice(-5).every((m) => wordCount(m.text) <= 1);

  // History that ends in her bubbles: a message the user sent while the last reply was in flight.
  const unansweredTurns: CompileTurn[] = plan?.followUp
    ? plan.followUp.unansweredIds.flatMap((id) => {
        const m = rows.find((x) => x.id === id);
        return m ? [{ id: m.id, who: m.who, text: m.text, edited: !!m.edited_at, quote: quoteFor(m) }] : [];
      })
    : [];
  const followUpText = [userText, ...unansweredTurns.map((t) => t.text)];
  const allowEmpty = !!plan?.followUp && !rest.coolOff && !rest.safetyMode && rest.milestone === null && !followUpText.some(backstopHit);
  const followUp = plan?.followUp ? { unanswered: unansweredTurns, allowEmpty } : null;
  const history: CompileTurn[] = rows.map((m) => ({
    id: m.id,
    who: m.who,
    text: m.text,
    edited: !!m.edited_at,
    quote: quoteFor(m),
    reacted: m.who === "me" && typeof m.meta?.reaction === "string" && m.meta.reaction !== "",
    safety: !!m.meta?.safety,
    effect: m.who === "them" && (typeof m.meta?.effect === "string" || typeof m.meta?.screen === "string"),
  }));
  return { ctx: { ...rest, history, lowEffort, followUp }, allowEmpty, unansweredTurns };
}
