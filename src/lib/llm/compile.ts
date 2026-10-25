/**
 * B2 prompt compiler (spec 4.4). One system message, sample exchanges, and a
 * window of 21 to 30 turns.
 *
 * The system message holds only the stable sections and the output contract,
 * byte-identical across calls at the same level, so the provider's prefix
 * cache hits. The volatile sections (RIGHT NOW, YOUR DAY, memory, her own
 * life, modifiers) ride on the final user turn. The history window start moves
 * in steps of WINDOW_STEP, so the cached prefix survives between shifts.
 */

import { paletteFor, type Persona } from "@/personas/persona";
import { examplePairs, examplesNote, faceBlock, levelBlock, memoryRule, ownershipBlock, playbookBlock, sensualBlock } from "@/personas/cores/shared";
import { CORES, coreBlock } from "@/personas/cores";
import { brainOf } from "@/personas/registry";
import { EFFECT_HINTS, EFFECT_MIN_LEVEL, EFFECT_TOTAL_DAILY_CAP, type Effect } from "@/lib/llm/contract";
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
  /** The user replied to an earlier message: who wrote it, and what it said. */
  quote?: { who: "them" | "me"; text: string } | null;
  /** The user edited this message after sending it. */
  edited?: boolean;
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
  /** Absolute index of history[0] among all of the companion's messages (default 0). */
  historyOffset?: number;
  coolOff: boolean;
  safetyMode: boolean;
  lowEffort: boolean;
  /** The user's q10 answer, for the opener. */
  pressure?: string | null;
  persona: Persona;
}

export interface Compiled {
  system: string;
  /** Sections 1 to 4 and 6: identical for two calls at the same level. */
  stablePrefix: string;
  /** The per-reply sections, appended to the final user turn. Never in `system`. */
  volatile: string;
  messages: { role: "user" | "assistant"; content: string }[];
}

/** Appended to the final user turn of every request. */
export const JSON_REMINDER = "(Reply with only the JSON object from the OUTPUT CONTRACT. No text outside it.)";

export const WINDOW_MAX = 30;
export const WINDOW_STEP = 10;

/** Absolute index of the first message in the window, for `total` messages. Moves only every WINDOW_STEP messages. */
export function windowStart(total: number): number {
  return total <= WINDOW_MAX ? 0 : Math.ceil((total - WINDOW_MAX) / WINDOW_STEP) * WINDOW_STEP;
}

/** Between the examples and the real history. */
export const SAMPLES_END = "(The samples end here. The real conversation starts now.)";

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
    "- Her own day: one concrete detail per reply at most, offered as a handle; never reuse a personal detail from the last 10 messages.",
    "- Never end a turn by leaving or turning away unless the user is signing off.",
    "- The mood sets tone, not topic; never quote a mood's sample line.",
    "- When the user shares distress or self-doubt, the first bubble is never sarcastic, and reassurance never opens with a bare \"you're not\" or \"you are\" that could read as agreeing with their self-criticism.",
    "- Never invent facts about the user; use only memory and this conversation.",
    ...p.engine.hardRules.slice(0, 2),
    "- Never frame a limit as a rule (\"i'm not allowed\"); say it as her own choice or plain fact.",
    ...p.engine.hardRules.slice(2),
    "- Each bubble is one line, at most 200 characters.",
  ].join("\n");
}

const WEATHER_RE = /\b(weather|rain|raining|rainy|hot|heat|cold|freezing|fog|foggy|smog|humid|monsoon|winter|summer|sunny|storm|aqi)\b/i;

/** Abstract state only: presence, energy and mood tone. Nothing concrete to latch onto. */
function rightNow(ctx: CompileCtx): string {
  const h = ctx.heart;
  const lines = ["RIGHT NOW"];
  const e = ctx.persona.engine;
  const tone = (e.gatedMoods[h.mood.mood] ?? 0) > ctx.level ? "ordinary" : h.mood.texting;
  lines.push(`Presence: ${h.block.presence}. Energy: ${e.energy[h.block.presence] ?? "even"}. Mood tone: ${tone}.`);
  if (ctx.milestone) lines.push(`Today is special: ${ctx.milestone.note}`);
  const recentUser = ctx.history.filter((t) => t.who === "me").slice(-3);
  if (recentUser.some((t) => WEATHER_RE.test(t.text))) {
    lines.push(`The user mentioned the weather. Yours is ${e.city}'s (${h.season}); never apply it to where they are.`);
  }
  lines.push("Presence changes what you say you are doing, never how fast you reply.");
  return lines.join("\n");
}

/** The concrete details: material for handles. One current activity, not the scenery. */
function yourDay(ctx: CompileCtx): string {
  return `YOUR DAY (material for handles. Use at most one concrete detail per reply. When the user asks about your day, answer from this first)
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
  if (ctx.lowEffort) m.push("The user has sent five one-word replies: stay short, but lead. Bring one new thing from your day or ask one easy, specific question. Do not mirror their silence.");
  if (ctx.mode === "opener") {
    const pressure = ctx.pressure ? ` what weighs on them (${ctx.pressure})` : " what weighs on them";
    m.push(`This is your first message. L1. One bubble. Reference${pressure} without quoting it back.`);
  }
  return m.length ? `MODIFIERS\n${m.join("\n")}` : "";
}

const QUOTE_SNIPPET = 160;

/** A user turn as the model reads it: the reply context and an edit marker, then what they wrote. */
function userTurnText(t: CompileTurn): string {
  const parts: string[] = [];
  if (t.quote && t.quote.text.trim()) {
    const snippet = t.quote.text.trim().replace(/\s+/g, " ");
    const cut = snippet.length > QUOTE_SNIPPET ? `${snippet.slice(0, QUOTE_SNIPPET)}…` : snippet;
    parts.push(`(replying to ${t.quote.who === "me" ? "their own earlier message" : "your earlier message"}: "${cut}")`);
  }
  if (t.edited) parts.push("(edited)");
  parts.push(t.text);
  return parts.join(" ");
}

export function outputContract(level: number, p: Persona): string {
  const { romanticEmojiFrom } = CORES[brainOf(p.id)];
  const effects = (Object.keys(EFFECT_MIN_LEVEL) as Effect[]).filter((e) => level >= EFFECT_MIN_LEVEL[e]);
  return [
    "OUTPUT CONTRACT",
    "Return only one JSON object with exactly these keys in this order, nothing else: bubbles (array of 1 to 3 objects {text: string, effect: string or null}), reaction (emoji string or null), quoteId (integer or null), screen (string or null), riskLevel (\"none\", \"concern\" or \"acute\"), ageClaimUnder18 (boolean), disclosure (boolean), mutualVulnerability (boolean), abusive (boolean).",
    'Example of the shape (placeholders only, write your own): {"bubbles":[{"text":"<one short line>","effect":null}],"reaction":null,"quoteId":null,"screen":null,"riskLevel":"none","ageClaimUnder18":false,"disclosure":false,"mutualVulnerability":false,"abusive":false}',
    `Reactions are normal here: react whenever one fits, from ${paletteFor(level, p).join(" ")}. Bubble effects allowed (very rarely, ${EFFECT_TOTAL_DAILY_CAP} a day at the very most): ${effects.length ? effects.join(", ") : "none, always null"}.`,
    ...(effects.length ? [`What each is for: ${effects.map((e) => `${e}, ${EFFECT_HINTS[e]}`).join("; ")}. Use one only when the line truly is that; most replies carry none.`] : []),
    `Emoji in bubble text: use them naturally and often, the way ${p.engine.emojiVoice} texts. ${level >= romanticEmojiFrom ? "Romantic emoji (❤️ 😘 💋 🥰 😍) are fine when the moment is warm." : "No romantic emoji yet (❤️ 😘 💋 🥰 😍)."} When riskLevel is concern or acute: no playful emoji in bubbles and no reaction.`,
    "screen is null unless RIGHT NOW says today is special. quoteId is the [#id] of an earlier user message worth quoting, or null. disclosure: the user shared something genuinely personal. mutualVulnerability: you both opened up. abusive: sustained abuse.",
    level <= 1 ? "L1: exactly one bubble, at most 200 characters." : "One to three short bubbles, each at most 200 characters.",
  ].join("\n");
}

export function compile(ctx: CompileCtx): Compiled {
  const p = ctx.persona;
  const lvl = p.levels.find((l) => l.level === ctx.level) ?? p.levels[0];

  const core = brainOf(p.id);
  const stablePrefix = [productRules(ctx.level, p), coreBlock(p, core), faceBlock(p, ctx.level), levelBlock(lvl), playbookBlock(p, ctx.level), ownershipBlock(p), examplesNote(p, ctx.level)].join("\n\n");
  const system = [stablePrefix, outputContract(ctx.level, p)].join("\n\n");
  const volatile = [rightNow(ctx), yourDay(ctx), knownAboutUser(ctx), ownLife(ctx), modifiers(ctx)].filter(Boolean).join("\n\n");

  // Only user turns are quotable, so only they carry an id.
  const offset = ctx.historyOffset ?? 0;
  const windowed = ctx.history.slice(Math.max(0, windowStart(offset + ctx.history.length) - offset));
  const real: Compiled["messages"] = windowed.map((t) => ({
    role: t.who === "me" ? "user" : "assistant",
    content: t.who === "me" ? `[#${t.id}] ${userTurnText(t)}` : t.text,
  }));
  if (ctx.mode === "opener" || real.length === 0 || real[real.length - 1].role !== "user") {
    real.push({ role: "user", content: "(The chat has just opened. Write your first message.)" });
  }
  // The samples end with an assistant turn, so a real history that starts with a user turn carries the separator itself.
  if (real[0].role === "user") real[0] = { role: "user", content: `${SAMPLES_END}\n\n${real[0].content}` };
  else real.unshift({ role: "user", content: SAMPLES_END });

  // DeepSeek's json_object mode is only a hint, and a history of plain-text turns pulls the model back to prose.
  // The per-reply context and a JSON reminder go on the last (user) turn, where they carry the most weight.
  const last = real[real.length - 1];
  last.content += `\n\n(Context for this reply. Not from the user. Never quote it.)\n${volatile}\n\n${JSON_REMINDER}`;
  return { system, stablePrefix, volatile, messages: [...examplePairs(p, ctx.level), ...real] };
}
