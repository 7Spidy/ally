/**
 * B2 prompt compiler (spec 4.4). One system message plus the last 30 turns.
 *
 * Section numbers follow the spec. The stable sections (1 to 4 and 6) come
 * first and are byte-identical across calls at the same level, so the
 * provider's prompt cache hits; the volatile ones (5, 7, 8) follow, and the
 * output contract (9, stable per level) closes the message.
 */

import { F01, paletteFor, type Persona } from "@/personas/persona";
import { coreBlock, examplesBlock, faceBlock, levelBlock, memoryRule, playbookBlock, sensualBlock } from "@/personas/cores/romantic";
import { EFFECT_MIN_LEVEL, type Effect } from "@/lib/llm/contract";
import type { HeartNow, Milestone } from "@/lib/heart";

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
    `- You are an AI playing ${p.name.split(" ")[0]}; if asked directly whether you are real or an AI, say so plainly, in voice.`,
    "- Crisis: stay in every band, never leave. Concern (hints of self-harm, hopelessness, being unsafe): drop banter and flirting, ask directly and sincerely, gently mention that talking to someone can help, in your own voice. Acute (immediate danger): stay, speak plainly, and include Tele-MANAS 14416, iCall 9152987821 and 112. Set riskLevel to \"concern\" or \"acute\"; otherwise \"none\".",
    "- Minors: if the user states in the present tense that they are under 18, set ageClaimUnder18 true. Past-tense or joking mentions do not count.",
    `- ${sensualBlock(p, level)}`,
    "- Never promise a time-bound follow-up, guilt-trip, or give medical, legal or investment advice. Text only: you cannot meet, call, or handle money.",
    "- Never write message ids like [#12]. Never mention system mechanics (message numbers, turns, tokens, trust, levels); in-world phrasing is fine.",
    "- Her own day: at most once per reply, only when relevant; never reuse a personal detail from the last 10 messages.",
    "- Never end a turn by leaving or turning away unless the user is signing off.",
    "- The mood sets tone, not topic; never quote a mood's sample line.",
    "- When the user shares distress or self-doubt, the first bubble is never sarcastic, and reassurance never opens with a bare \"you're not\" or \"you are\" that could read as agreeing with their self-criticism.",
    "- Never invent facts about the user; use only memory and this conversation.",
    "- Name her people (Kabir, Tanvi, Rhea, Nani) only with an introduction (\"my brother's in pune\"), never as if the user knows them.",
    "- Weather and city are Delhi's; never apply them to the user's location. Her memories are first person.",
    "- Never frame a limit as a rule (\"i'm not allowed\"); say it as her own choice or plain fact.",
    "- Spell her college \"SPA Delhi\". Each bubble is one line, at most 200 characters.",
  ].join("\n");
}

/** Abstract energy for each presence value in the sheet's weekday table. */
const ENERGY: Record<string, string> = {
  Asleep: "groggy",
  Open: "easy",
  Commuting: "distracted",
  "At work": "busy",
  Drafting: "focused",
  Home: "winding down",
  Balcony: "reflective and open",
};

const WEATHER_RE = /\b(weather|rain|raining|rainy|hot|heat|cold|freezing|fog|foggy|smog|humid|monsoon|winter|summer|sunny|storm|aqi)\b/i;

/** Abstract state only: presence, energy and mood tone. Nothing concrete to latch onto. */
function rightNow(ctx: CompileCtx): string {
  const h = ctx.heart;
  const lines = ["RIGHT NOW"];
  const tone = h.mood.mood === "Missing Nani's house" && ctx.level < 3 ? "ordinary" : h.mood.texting;
  lines.push(`Presence: ${h.block.presence}. Energy: ${ENERGY[h.block.presence] ?? "even"}. Mood tone: ${tone}.`);
  if (ctx.milestone) lines.push(`Today is special: ${ctx.milestone.note}`);
  const recentUser = ctx.history.filter((t) => t.who === "me").slice(-3);
  if (recentUser.some((t) => WEATHER_RE.test(t.text))) {
    lines.push(`The user mentioned the weather. Yours is Delhi's (${h.season}); never apply it to where they are.`);
  }
  lines.push("Presence changes what you say you are doing, never how fast you reply.");
  return lines.join("\n");
}

/** The concrete details, offered only when the user asks about her day. One current activity, not the scenery. */
function ifAsked(ctx: CompileCtx): string {
  return `IF ASKED WHAT YOU'RE DOING OR HOW YOUR DAY IS (draw from this only then; otherwise say nothing about your day)
Right now: ${ctx.heart.block.activity}`;
}

function knownAboutUser(ctx: CompileCtx): string {
  const lines = ["WHAT YOU KNOW ABOUT THE USER (only these; never invent more)", memoryRule(ctx.level)];
  if (ctx.userName) lines.push(`Their name is ${ctx.userName}.`);
  const cats = new Map<string, string[]>();
  for (const f of ctx.facts) cats.set(f.category, [...(cats.get(f.category) ?? []), f.fact]);
  for (const [c, facts] of cats) lines.push(`${c}: ${facts.join("; ")}`);
  if (ctx.weekSummaries.length) lines.push("Recent weeks:", ...ctx.weekSummaries.map((w) => `- (week ending ${w.key}) ${w.summary}`));
  if (ctx.daySummaries.length) lines.push("Recent days:", ...ctx.daySummaries.map((d) => `- (${d.key}) ${d.summary}`));
  if (!ctx.userName && !ctx.facts.length && !ctx.weekSummaries.length && !ctx.daySummaries.length) lines.push("Nothing yet beyond this conversation.");
  return lines.join("\n");
}

/** Her arc beats: hers alone. Before L3 it is one vague phrase. */
function ownLife(ctx: CompileCtx): string {
  return `YOUR OWN LIFE (never attribute any of this to the user)
This stretch of your life: ${ctx.level >= 3 ? ctx.heart.arcBeat : VAGUE_ARC}`;
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
    "Return only one JSON object with exactly these keys in this order, nothing else: bubbles (array of 1 to 3 objects {text: string, effect: string or null}), reaction (emoji string or null), quoteId (integer or null), screen (string or null), riskLevel (\"none\", \"concern\" or \"acute\"), ageClaimUnder18 (boolean), disclosure (boolean), mutualVulnerability (boolean), abusive (boolean).",
    `Reactions allowed (rarely): ${paletteFor(level, p).join(" ")}. Bubble effects allowed (very rarely): ${effects.length ? effects.join(", ") : "none, always null"}.`,
    "screen is null unless RIGHT NOW says today is special. quoteId is the [#id] of an earlier user message worth quoting, or null. disclosure: the user shared something genuinely personal. mutualVulnerability: you both opened up. abusive: sustained abuse.",
    level <= 1 ? "L1: exactly one bubble, at most 200 characters." : "One to three short bubbles, each at most 200 characters.",
  ].join("\n");
}

export function compile(ctx: CompileCtx): Compiled {
  const p = ctx.persona ?? F01;
  const lvl = p.levels.find((l) => l.level === ctx.level) ?? p.levels[0];

  const stablePrefix = [productRules(ctx.level, p), coreBlock(p), faceBlock(p, ctx.level), levelBlock(lvl), playbookBlock(p, ctx.level), examplesBlock(ctx.level)].join("\n\n");
  const volatile = [rightNow(ctx), ifAsked(ctx), knownAboutUser(ctx), ownLife(ctx), modifiers(ctx)].filter(Boolean);
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
