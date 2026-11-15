/**
 * Prints the exact messages the production chat route would send to the LLM for one turn,
 * as a JSON array on stdout (system message first, as buildBody sends it). Stdout is JSON only;
 * logs go to stderr. No network, no DB: a fresh user with an empty memory vault.
 *
 *   echo '{"persona":"ira","level":2,"history":[],"userText":"hey","followup":false,"istTime":"21:30 Tuesday"}' | npx tsx scripts/build_messages.ts
 *
 * stdin: { persona: "ira"|"noor", level: 1-6, history: [{role, content}], userText, followup, istTime, userName? }
 * followup=true means userText was sent while the last reply was still in flight: it is slotted
 * in before history's trailing assistant bubbles, which are then "answers" to the message before it.
 * Companion id "c_eval" and a 70-day-old relationship match the eval scripts.
 */
import { readFileSync } from "node:fs";

// Anything a module logs must not reach stdout.
console.log = console.info = console.warn = console.error;

import { compile } from "@/lib/llm/compile";
import { buildTurnCtx, type TurnMsgRow } from "@/lib/llm/turnCtx";
import { planReply } from "@/lib/llm/replyPlan";
import * as heart from "@/lib/heart";
import { personaFor } from "@/personas/registry";
import { FIXED_CREATED } from "./_env";

const PERSONAS: Record<string, string> = { ira: "F01", noor: "F02" };
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const IST_OFFSET_MS = 5.5 * 3600000;

interface Input {
  persona: string;
  level: number;
  history: { role: "user" | "assistant"; content: string }[];
  userText: string;
  followup: boolean;
  istTime: string;
  userName?: string;
}

/** "21:30 Tuesday" (either order) to a timestamp in the week of 2026-05-10 (a Sunday), IST. */
function parseIst(s: string): number {
  const t = s.match(/(\d{1,2}):(\d{2})/);
  const d = WEEKDAYS.indexOf((s.match(/[A-Za-z]+/g) ?? []).map((w) => w.toLowerCase()).find((w) => WEEKDAYS.includes(w)) ?? "");
  if (!t || d < 0) throw new Error(`istTime must look like "21:30 Tuesday", got "${s}"`);
  return Date.UTC(2026, 4, 10 + d, Number(t[1]), Number(t[2])) - IST_OFFSET_MS;
}

function main() {
  const inp = JSON.parse(readFileSync(0, "utf8")) as Input;
  if (!PERSONAS[inp.persona]) throw new Error(`persona must be ira or noor, got "${inp.persona}"`);
  const persona = personaFor(PERSONAS[inp.persona]);
  if (!Number.isInteger(inp.level) || inp.level < 1 || inp.level > 6) throw new Error("level must be 1 to 6");
  const at = parseIst(inp.istTime);

  // Rows with ascending ids. A follow-up slots userText ahead of the trailing assistant run.
  const hist = inp.history.map((m) => ({ who: m.role === "user" ? ("me" as const) : ("them" as const), text: m.content }));
  let tail = hist.length;
  while (tail > 0 && hist[tail - 1].who === "them") tail--;
  const useFollowUp = inp.followup && tail > 0 && tail < hist.length;
  const ordered = useFollowUp ? [...hist.slice(0, tail), { who: "me" as const, text: inp.userText }, ...hist.slice(tail)] : [...hist, { who: "me" as const, text: inp.userText }];
  // ordered[tail] is the new message; the bubbles after it answered ordered[tail - 1] (id tail).
  const rows: (TurnMsgRow & { in_reply_to: number | null })[] = ordered.map((m, i) => ({
    id: i + 1,
    who: m.who,
    text: m.text,
    meta: null,
    in_reply_to: useFollowUp && i > tail ? tail : null,
  }));

  const userRow = useFollowUp ? rows[tail] : rows[rows.length - 1];
  const plan = planReply(rows, userRow.id);
  const h = heart.now({ id: "c_eval", createdAt: FIXED_CREATED }, at, persona);
  const { ctx } = buildTurnCtx({
    level: inp.level,
    mode: "reply",
    userName: inp.userName ?? "",
    heart: h,
    milestone: null,
    facts: [],
    weekSummaries: [],
    daySummaries: [],
    rows,
    quotable: new Map(rows.map((r) => [r.id, { who: r.who, text: r.text }])),
    plan: useFollowUp ? plan : null,
    userText: inp.userText,
    historyOffset: 0,
    coolOff: false,
    safetyMode: false,
    pressure: null,
    persona,
  });
  const compiled = compile(ctx);
  process.stdout.write(JSON.stringify([{ role: "system", content: compiled.system }, ...compiled.messages]) + "\n");
}

main();
