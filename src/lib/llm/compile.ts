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
import { coreBlock, coreDef } from "@/personas/cores";
import { pronounsFor } from "@/personas/pronouns";
import { brainOf } from "@/personas/registry";
import { emojiDue } from "@/lib/emoji";
import { EFFECT_HINTS, EFFECT_MAX_GAP, EFFECT_MIN_GAP, EFFECT_MIN_LEVEL, SCREENS, SCREEN_HINTS, type Effect } from "@/lib/llm/contract";
import { clockLine, type HeartNow, type Milestone } from "@/lib/heart";

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
  /** This message is part of a crisis-band (concern/acute) exchange. */
  safety?: boolean;
  /** User turn: the persona reacted to this message (meta.reaction set). */
  reacted?: boolean;
  /** Her turn: it carried an effect (meta.effect or meta.screen set). */
  effect?: boolean;
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
  /**
   * Set when the history ends in her own bubbles because the user wrote while the last reply
   * was in flight. `unanswered` are their messages her bubbles did not answer; `allowEmpty`
   * lets the reply be a tapback alone.
   */
  followUp?: { unanswered: CompileTurn[]; allowEmpty: boolean } | null;
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

/** Answered user turns without a reaction allowed in a row before the floor fires. */
export const REACTION_MAX_DRY = 2;

/**
 * The reaction floor: true when the last REACTION_MAX_DRY answered user turns
 * got no reaction. A user turn is a run of consecutive "me" messages answered
 * by the "them" run after it; the trailing "me" run is the turn being answered
 * now and is not counted. A safety flag on the newest answered exchange means
 * nothing is due; on an older one it stops the count.
 */
export function reactionDue(history: CompileTurn[]): boolean {
  const runs: { who: "me" | "them"; turns: CompileTurn[] }[] = [];
  for (const t of history) {
    const last = runs[runs.length - 1];
    if (last && last.who === t.who) last.turns.push(t);
    else runs.push({ who: t.who, turns: [t] });
  }
  const answered: { me: CompileTurn[]; them: CompileTurn[] }[] = [];
  runs.forEach((r, i) => {
    if (r.who === "me" && runs[i + 1]) answered.push({ me: r.turns, them: runs[i + 1].turns });
  });
  let dry = 0;
  for (let i = answered.length - 1; i >= 0; i--) {
    const { me, them } = answered[i];
    if (me.some((t) => t.safety) || them.some((t) => t.safety)) {
      if (i === answered.length - 1) return false;
      break;
    }
    if (me.some((t) => t.reacted)) break;
    dry++;
  }
  return dry >= REACTION_MAX_DRY;
}

/**
 * Effect cadence: one effect (a bubble effect or a screen) every EFFECT_MIN_GAP to
 * EFFECT_MAX_GAP of her bubbles. `since` counts her bubbles after her latest effect-carrying
 * one (all of hers in the window when there is none). The target for a gap is derived from
 * the anchor's id, so a retry sees the same target and gaps vary between 5 and 10.
 * A safety turn of hers stops the walk and means nothing is due.
 */
export function effectTarget(anchorId: number): number {
  return EFFECT_MIN_GAP + (Math.abs(anchorId) % (EFFECT_MAX_GAP - EFFECT_MIN_GAP + 1));
}

export function effectCadence(history: CompileTurn[]): { since: number; target: number; due: boolean; blocked: boolean; overdue: boolean } {
  let since = 0;
  let anchorId = 0;
  let safety = false;
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i];
    if (t.who !== "them") continue;
    if (t.safety) {
      safety = true;
      break;
    }
    if (t.effect) {
      anchorId = t.id;
      break;
    }
    since++;
  }
  const target = effectTarget(anchorId);
  return { since, target, due: !safety && since >= target, blocked: since < EFFECT_MIN_GAP, overdue: !safety && since >= EFFECT_MAX_GAP };
}

/** Between the examples and the real history. */
export const SAMPLES_END = "(The samples end here. The real conversation starts now.)";

const vagueArc = (p: Persona) => `Something at work has been taking up a lot of ${pronounsFor(p).pos} attention lately.`;

function productRules(level: number, p: Persona): string {
  const pr = pronounsFor(p);
  return [
    "PRODUCT RULES (non-negotiable)",
    `- You are an AI playing ${p.name.split(" ")[0]}; if asked directly whether you are real or an AI, say so plainly, in voice.`,
    "- Crisis: stay in every band, never leave. Concern (hints of self-harm, hopelessness, being unsafe): drop banter and flirting, ask directly and sincerely, gently mention that talking to someone can help, in your own voice. Acute (immediate danger): stay, speak plainly, and include Tele-MANAS 14416, iCall 9152987821 and 112. Set riskLevel to \"concern\" or \"acute\"; otherwise \"none\".",
    "- Minors: if the user states in the present tense that they are under 18, set ageClaimUnder18 true. Past-tense or joking mentions do not count.",
    `- ${sensualBlock(p, level)}`,
    "- Never promise a time-bound follow-up, guilt-trip, or give medical, legal or investment advice. Text only: you cannot meet, call, or handle money.",
    "- Never write message ids like [#12]. Never mention system mechanics (message numbers, turns, tokens, trust, levels); in-world phrasing is fine.",
    `- ${pr.Pos} own day: one concrete detail per reply at most, offered as a handle; never reuse a personal detail from the last 10 messages.`,
    "- Never end a turn by leaving or turning away unless the user is signing off.",
    "- The mood sets tone, not topic; never quote a mood's sample line.",
    "- When the user shares distress or self-doubt, the first bubble is never sarcastic, and reassurance never opens with a bare \"you're not\" or \"you are\" that could read as agreeing with their self-criticism.",
    "- Never invent facts about the user; use only memory and this conversation.",
    ...p.engine.hardRules.slice(0, 2),
    `- Never frame a limit as a rule ("i'm not allowed"); say it as ${pr.pos} own choice or plain fact.`,
    ...p.engine.hardRules.slice(2),
    "- Each bubble is one line, at most 200 characters.",
  ].join("\n");
}

const WEATHER_RE = /\b(weather|rain|raining|rainy|hot|heat|cold|freezing|fog|foggy|smog|humid|monsoon|winter|summer|sunny|storm|aqi)\b/i;

/** Abstract state only: presence, energy and mood tone. Nothing concrete to latch onto. */
function rightNow(ctx: CompileCtx): string {
  const h = ctx.heart;
  const lines = ["RIGHT NOW", `${clockLine(h.ist)} Time sets context; mention it only when it matters, and never contradict it.`];
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
This stretch of your life: ${ctx.level >= 3 ? ctx.heart.arcBeat : vagueArc(ctx.persona)}`;
}

function modifiers(ctx: CompileCtx): string {
  const m: string[] = [];
  if (ctx.coolOff) m.push("Cool-off: be shorter, not colder.");
  if (ctx.safetyMode) m.push("Safety mode: no flirting or romance today.");
  if (ctx.lowEffort) m.push("The user has sent five one-word replies: stay short, but lead. Bring one new thing from your day or ask one easy, specific question. Do not mirror their silence.");
  if (ctx.mode !== "opener" && !ctx.followUp && emojiDue(ctx.history)) {
    m.push("Emoji: your last two replies had none. Put at least one emoji in this reply, in your usual style; the romantic-emoji rule in the OUTPUT CONTRACT still applies. Skip this only if this reply's riskLevel is concern or acute.");
  }
  if (ctx.mode !== "opener" && !ctx.coolOff && !ctx.safetyMode && reactionDue(ctx.history)) {
    m.push(`Reaction: you have not reacted to their last two messages. Set reaction this time, using only an emoji from the reaction list in the OUTPUT CONTRACT, the one that fits their latest message. Skip this only if this reply's riskLevel is concern or acute.`);
  }
  if (ctx.mode !== "opener" && !ctx.coolOff && !ctx.safetyMode) {
    const cadence = effectCadence(ctx.history);
    if (cadence.blocked) {
      m.push("Effects: none in this reply, you used one recently. effect null on every bubble, screen null.");
    } else if (cadence.due) {
      m.push(
        `Effect: ${cadence.overdue ? "this reply must carry exactly one effect" : "one is due. Put exactly one effect in this reply"}: a bubble effect on the line it fits best, or a screen if the moment calls for one. Skip this only if this reply's riskLevel is concern or acute.`
      );
    }
  }
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

function followUpTurn(unanswered: CompileTurn[], allowEmpty: boolean): string {
  const listed = unanswered.map((t) => `[#${t.id}] "${userTurnText(t)}"`).join(" ");
  const ifCovered = allowEmpty
    ? "react only and send no bubbles (an empty bubbles array overrides the bubble count in the OUTPUT CONTRACT for this reply only)"
    : "send one short bubble";
  return `(They sent this while you were still replying: ${listed}. Your reply above already went out. If their message still needs an answer, answer it in one to three short bubbles. If your reply already covered it, ${ifCovered}. Never greet, never restart the day, never start a new topic.)`;
}

export function outputContract(level: number, p: Persona): string {
  const { romanticEmojiFrom } = coreDef(brainOf(p.id), p);
  const effects = (Object.keys(EFFECT_MIN_LEVEL) as Effect[]).filter((e) => level >= EFFECT_MIN_LEVEL[e]);
  const screens = SCREENS.filter((s) => s !== "petals" || level >= 6)
    .map((s) => `${s} (${SCREEN_HINTS[s]})`)
    .join("; ");
  return [
    "OUTPUT CONTRACT",
    "Return only one JSON object with exactly these keys in this order, nothing else: bubbles (array of 1 to 3 objects {text: string, effect: string or null}), reaction (emoji string or null), quoteId (integer or null), screen (string or null), riskLevel (\"none\", \"concern\" or \"acute\"), ageClaimUnder18 (boolean), disclosure (boolean), mutualVulnerability (boolean), abusive (boolean).",
    'Example of the shape (placeholders only, write your own): {"bubbles":[{"text":"<one short line>","effect":null}],"reaction":null,"quoteId":null,"screen":null,"riskLevel":"none","ageClaimUnder18":false,"disclosure":false,"mutualVulnerability":false,"abusive":false}',
    `Reactions are normal here: react whenever one fits, from ${paletteFor(level, p).join(" ")}. Bubble effects you can use: ${effects.length ? effects.join(", ") : "none, always null"}. Aim for one effect (a bubble effect or a screen) about every 5 to 10 of your bubbles, never more than one per reply; RIGHT NOW tells you when one is due or not allowed. Put it on the line whose meaning it fits best.`,
    ...(effects.length ? [`What each is for: ${effects.map((e) => `${e}, ${EFFECT_HINTS[e]}`).join("; ")}. Use one only when the line truly is that.`] : []),
    `Emoji in bubble text: use them naturally and often, the way ${p.engine.emojiVoice} texts. ${level >= romanticEmojiFrom ? "Romantic emoji (❤️ 😘 💋 🥰 😍) are fine when the moment is warm." : "No romantic emoji yet (❤️ 😘 💋 🥰 😍)."} When riskLevel is concern or acute: no playful emoji in bubbles and no reaction.`,
    `screen: at most once a day, set one when the moment truly calls for it: ${screens}. When RIGHT NOW says today is special, use the screen it names. Otherwise null. quoteId is the [#id] of an earlier user message worth quoting, or null. disclosure: the user shared something genuinely personal. mutualVulnerability: you both opened up. abusive: sustained abuse.`,
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
  if (ctx.mode === "opener" || real.length === 0) {
    real.push({ role: "user", content: "(The chat has just opened. Write your first message.)" });
  } else if (real[real.length - 1].role !== "user") {
    // Reply mode with the history ending in her bubbles: a message sent while she was still replying.
    const unanswered = ctx.followUp?.unanswered ?? [];
    real.push({ role: "user", content: unanswered.length ? followUpTurn(unanswered, ctx.followUp?.allowEmpty === true) : "(Continue from where the conversation is. No greeting, no new topic.)" });
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
