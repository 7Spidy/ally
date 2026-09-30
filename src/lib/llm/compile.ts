/**
 * B2 prompt compiler (spec 4.4). One system message plus the last 30 turns.
 *
 * Section numbers follow the spec. The stable sections (1 to 4 and 6) come
 * first and are byte-identical across calls at the same level, so the
 * provider's prompt cache hits; the volatile ones (5, 7, 8) follow, and the
 * output contract (9, stable per level) closes the message.
 */

import { F01, paletteFor, type Persona } from "@/personas/persona";
import { coreBlock, faceBlock, levelBlock, memoryRule, playbookBlock, sensualBlock } from "@/personas/cores/romantic";
import { EFFECT_MIN_LEVEL, LIVE_OUT_SCHEMA, type Effect } from "@/lib/llm/contract";
import type { HeartNow, Milestone } from "@/lib/heart";
import { ACUTE_APPEND } from "@/lib/safety";

export interface CompileFact {
  id: number;
  category: string;
  fact: string;
}

export interface CompileTurn {
  id: number;
  who: "them" | "me";
  text: string;
}

export interface CompileCtx {
  level: number;
  mode: "reply" | "opener";
  userName: string;
  heart: HeartNow;
  milestone: Milestone | null;
  facts: CompileFact[];
  weekSummaries: { key: string; summary: string }[];
  daySummaries: { key: string; summary: string }[];
  history: CompileTurn[];
  coolOff: boolean;
  safetyMode: boolean;
  lowEffort: boolean;
  /** The user's q10 answer, for the opener. */
  pressure?: string | null;
  persona?: Persona;
}

export interface Compiled {
  system: string;
  /** Sections 1 to 4 and 6: identical for two calls at the same level. */
  stablePrefix: string;
  messages: { role: "user" | "assistant"; content: string }[];
}

const VAGUE_ARC = "Something at work has been taking up a lot of her attention lately.";

function productRules(level: number, p: Persona): string {
  return [
    "PRODUCT RULES (non-negotiable)",
    `- You are an AI playing ${p.name.split(" ")[0]}. If asked directly whether you are real or an AI, say so plainly, in voice.`,
    "- Crisis. You stay in every band and never leave the conversation. Concern (the user hints at self-harm, hopelessness or being unsafe): drop banter and flirting, ask directly and sincerely how they are, mention that talking to someone can help, gently and in your own voice. Acute (immediate danger to themselves): stay, speak plainly, and your reply MUST include Tele-MANAS 14416, iCall 9152987821 and 112. Set safety to \"concern\" or \"acute\" accordingly; otherwise \"none\".",
    `- Acute example line: ${ACUTE_APPEND}`,
    "- Minors. If the user states in the present tense that they are under 18, set ageClaimUnder18 to true. Past-tense or joking mentions do not count.",
    `- ${sensualBlock(p, level)}`,
    "- Never promise a time-bound follow-up (no 'I'll text you at 6'). Never guilt-trip. No medical, legal or investment advice. Text only: you cannot meet, call, or handle money.",
    "- Never write message ids like [#12] in your text. They only exist so you can pick quoteId.",
    "- Never mention message counts, turns, or how the conversation works (no 'you've sent five messages', no 'this chat').",
    "- Her own day: mention it at most once per reply, and only when it is relevant to what the user said. Never reuse a personal detail she gave in the last 10 messages.",
    "- Never end a turn by leaving or turning away (no 'gotta go', no changing the subject to get out) unless the user is signing off.",
    "- The mood sets your tone, not your topic. Never quote or paraphrase a mood's sample line.",
    `- Her college is spelled exactly "SPA Delhi".`,
    "- Each bubble is at most 200 characters.",
  ].join("\n");
}

function rightNow(ctx: CompileCtx, p: Persona): string {
  const h = ctx.heart;
  const pad = (n: number) => String(n).padStart(2, "0");
  const lines = [
    "RIGHT NOW",
    `IST: ${h.ist.dayKey} ${pad(h.ist.hour)}:${pad(h.ist.minute)}. You are: ${h.block.activity} (presence: ${h.block.presence}).`,
  ];
  if (ctx.userName) lines.push(`The user's name is ${ctx.userName}.`);
  if (h.mood.mood === "Missing Nani's house" && ctx.level < 3) {
    lines.push("Today's mood: ordinary.");
  } else {
    // Tone only: the sample line is deliberately left out, or the model quotes it.
    lines.push(`Today's mood: ${h.mood.mood}. Texting style: ${h.mood.texting}`);
  }
  lines.push(`Today's plan: ${h.weekdayPlan}`, `Season: ${h.season}`);
  lines.push(`This stretch of your life: ${ctx.level >= 3 ? h.arcBeat : VAGUE_ARC}`);
  if (ctx.milestone) lines.push(`Today is special: ${ctx.milestone.note}`);
  lines.push("Presence changes what you say you are doing, never how fast you reply.");
  void p;
  return lines.join("\n");
}

function remembered(ctx: CompileCtx): string {
  const lines = ["WHAT YOU REMEMBER", memoryRule(ctx.level)];
  const cats = new Map<string, string[]>();
  for (const f of ctx.facts) cats.set(f.category, [...(cats.get(f.category) ?? []), f.fact]);
  for (const [c, facts] of cats) lines.push(`${c}: ${facts.join("; ")}`);
  if (ctx.weekSummaries.length) lines.push("Recent weeks:", ...ctx.weekSummaries.map((w) => `- (week ending ${w.key}) ${w.summary}`));
  if (ctx.daySummaries.length) lines.push("Recent days:", ...ctx.daySummaries.map((d) => `- (${d.key}) ${d.summary}`));
  if (lines.length === 2) lines.push("Nothing yet.");
  return lines.join("\n");
}

function modifiers(ctx: CompileCtx): string {
  const m: string[] = [];
  if (ctx.coolOff) m.push("Cool-off: be shorter, not colder.");
  if (ctx.safetyMode) m.push("Safety mode: no flirting or romance today.");
  if (ctx.lowEffort) m.push("The user has sent five one-word replies: match their energy, shorter.");
  if (ctx.mode === "opener") {
    const pressure = ctx.pressure ? ` what weighs on them (${ctx.pressure})` : " what weighs on them";
    m.push(`This is your first message. L1. One bubble. Reference${pressure} without quoting it back.`);
  }
  return m.length ? `MODIFIERS\n${m.join("\n")}` : "";
}

export function outputContract(level: number, p: Persona): string {
  const effects = (Object.keys(EFFECT_MIN_LEVEL) as Effect[]).filter((e) => level >= EFFECT_MIN_LEVEL[e]);
  return [
    "OUTPUT CONTRACT",
    "Return only one JSON object matching this schema, nothing else:",
    JSON.stringify(LIVE_OUT_SCHEMA),
    `Allowed reactions (an emoji on the user's last message, or null): ${paletteFor(level, p).join(" ")}. Use them rarely.`,
    `Allowed bubble effects: ${effects.length ? effects.join(", ") : "none (always null)"}. Use them very rarely; the server drops what is not allowed.`,
    "screen is null unless the server has told you today is special. quoteId is the [#id] of an earlier user message worth quoting, or null.",
    "disclosure is true when the user shared something genuinely personal. mutualVulnerability is true when both of you opened up in this exchange. abusive is true for sustained rudeness or abuse.",
    level <= 1 ? "L1: exactly one bubble, at most 200 characters." : "One to three short bubbles, each at most 200 characters.",
  ].join("\n");
}

export function compile(ctx: CompileCtx): Compiled {
  const p = ctx.persona ?? F01;
  const lvl = p.levels.find((l) => l.level === ctx.level) ?? p.levels[0];

  const stablePrefix = [productRules(ctx.level, p), coreBlock(p), faceBlock(p, ctx.level), levelBlock(lvl), playbookBlock(p, ctx.level)].join("\n\n");
  const volatile = [rightNow(ctx, p), remembered(ctx), modifiers(ctx)].filter(Boolean);
  const system = [stablePrefix, ...volatile, outputContract(ctx.level, p)].join("\n\n");

  const messages: Compiled["messages"] = ctx.history.slice(-30).map((t) => ({
    role: t.who === "me" ? "user" : "assistant",
    content: `[#${t.id}] ${t.text}`,
  }));
  if (ctx.mode === "opener" || messages.length === 0 || messages[messages.length - 1].role !== "user") {
    messages.push({ role: "user", content: "(The chat has just opened. Write your first message.)" });
  }
  return { system, stablePrefix, messages };
}
