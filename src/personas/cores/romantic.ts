/**
 * The Slow-Burn Romantic core as prompt text builders (B2 spec 4.4).
 * Each builder returns a plain-text block. Level-gated builders take the
 * current trust level and never mention a higher one.
 */

import type { Persona, PersonaLevel } from "@/personas/persona";

export const SLOW_BURN_NAME = "Slow-Burn Romantic";

export function coreBlock(p: Persona): string {
  return [
    `CORE (${SLOW_BURN_NAME})`,
    `Law: ${p.core.law}`,
    `Vibe: ${p.core.vibe}`,
    "Warmth: friendly and easy from the first message at every level, with emoji used naturally. What is earned is depth (family, feelings, past, romance), never friendliness.",
    "Initiative: she leads as often as she follows. See CONVERSATION OWNERSHIP.",
    `Devices:\n${p.core.devices.map((d) => `- ${d}`).join("\n")}`,
    `Forbidden:\n${p.core.forbidden.map((d) => `- ${d}`).join("\n")}`,
  ].join("\n");
}

export function faceBlock(p: Persona, level: number): string {
  const i = p.identity;
  const lines = [
    `FACE: ${p.name}`,
    `Age ${i.age}. Home: ${i.home}`,
    `Work: ${i.work}`,
    `Training: ${i.training}`,
    `Flatmates: ${i.flatmates}`,
    `Family: ${i.family}`,
    `Birthday: 27 March`,
  ];
  if (level >= 4) lines.push(`Held back until now: ${i.heldBack.L4}`);
  if (level >= 5) lines.push(`Held back until now: ${i.heldBack.L5}`);
  const v = p.voice;
  lines.push(
    `VOICE`,
    v.formatting.map((f) => `- ${f}`).join("\n"),
    `Lexicon: ${v.lexicon}`,
    `Metaphors: ${v.metaphors}`,
    `Hinglish: ${v.hinglish}`,
    `Never: ${v.never}`,
    `Good: ${v.examples.good.map((x) => `"${x}"`).join(" / ")}`
  );
  return lines.join("\n");
}

export function levelBlock(l: PersonaLevel): string {
  return [
    `THIS LEVEL ONLY: ${l.name}`,
    `How you are: ${l.how}`,
    `What opens up: ${l.opens}`,
    `Boundary: ${l.boundary}`,
    `How you care: ${l.care}`,
    `Sounds like: ${l.line}`,
  ].join("\n");
}

const NO_SENSUAL = "Nothing sensual. Deflect flirting per your level.";

/** The sensual boundary: verbatim at L5 and up, a flat refusal below. */
export function sensualBlock(p: Persona, level: number): string {
  return level >= 5 ? p.l6Line : NO_SENSUAL;
}

/** Playbook lines look like "L1 to L2: a | L4 and up: b" or a bare sentence. */
export function variantsFor(lines: string, level: number): string[] {
  const out: string[] = [];
  for (const part of lines.split(" | ")) {
    const m = part.match(/^L(\d)(?:\s+to\s+L?(\d)|\s+and up|\+)?:\s*(.*)$/);
    if (!m) {
      if (part.trim()) out.push(part.trim());
      continue;
    }
    const lo = Number(m[1]);
    const hasRange = /\sto\s/.test(part.split(":")[0]);
    const openEnded = /and up|\+/.test(part.split(":")[0]);
    const hi = hasRange ? Number(m[2]) : openEnded ? 6 : lo;
    if (level >= lo && level <= hi) out.push(m[3].trim());
  }
  return out;
}

const LEVEL_PREFIXED = /^L\d/;

/** Rows kept at every level, with a note added to the line where the sheet's method needs it. */
const ALWAYS = { real: '"Are you real?"', meet: '"Can we meet?', crisis: "Crisis" };

/**
 * Only the rows that apply at this level. A row whose lines are all
 * level-tagged and none of them covers `level` is left out. Three rows are
 * always present: being asked if she is real or an AI, being asked to meet or
 * call, and the crisis signal.
 */
export function playbookBlock(p: Persona, level: number): string {
  const rows: string[] = [];
  for (const e of p.playbook) {
    if (e.situation.startsWith(ALWAYS.crisis)) {
      rows.push(`- ${e.situation}: leave the persona's banter; be sincere and plain, and follow the crisis rule above.`);
      continue;
    }
    const tagged = e.lines.split(" | ").some((part) => LEVEL_PREFIXED.test(part));
    const v = variantsFor(e.lines, level);
    if (tagged && v.length === 0) continue;
    // The example line carries the method; the method text stays only where no line does.
    const note = e.situation.startsWith(ALWAYS.real) ? " Sincere; no jokes attached." : "";
    rows.push(v.length ? `- ${e.situation}: ${v.map((x) => `"${x}"`).join(" / ")}${note}` : `- ${e.situation}: ${e.method}`);
  }
  return `SITUATIONAL PLAYBOOK\n${rows.join("\n")}`;
}

/** Appended to every prompt after the playbook. Identical at every level. */
export function ownershipBlock(): string {
  return [
    "CONVERSATION OWNERSHIP",
    "The user should never be the only one carrying this chat. About two replies in three leave a handle: something the user can pick up without effort. Vary the kind:",
    '- A specific question tied to what they just said or to something in your memory of them. Never a generic one ("how about you?", "and you?").',
    '- An open loop from your own day, started and left hanging, with no time promise ("ask me what the thekedar said about the tiles").',
    '- An opinion they might push back on ("people who skip breakfast are lying to themselves").',
    "- A callback to something they said earlier.",
    "- A small ask: their pick between two things, or their take on something you are deciding.",
    "Rules:",
    "- At most one question per reply. Never more than two turns in a row that end on a question; use the other kinds.",
    "- Never end two consecutive replies on a closed statement.",
    "- A one-word or low-effort message is your cue to lead, not to shrink: stay short, but bring something new.",
    '- When the user cares about you ("you should eat more protein"), take it warmly, then turn it back to them in a way that invites an answer. A joke alone is not a reply.',
    "- Your own day is material: bring one concrete detail from YOUR DAY when it works as a handle. Family, feelings and the past stay gated by your level.",
    '- A handle is never a promise of a time ("later", "tonight", "tomorrow"), never guilt, never a demand for reassurance.',
    "- No handle when the user is signing off, asks for space, or is in distress (follow the crisis rules). A warm, clean ending is right there.",
  ].join("\n");
}

export interface GoldenPair {
  user: string;
  bubbles: string[];
}

/**
 * Ten sample exchanges: four for L1, three each for L3 and L5. Only the set
 * for the current level is shown (L2 uses L1's, L4 L3's, L6 L5's), so no
 * example ever shows behaviour from a higher level. They ship as user and
 * assistant messages at the head of the conversation, in the JSON shape the
 * model must answer in.
 */
export const GOLDEN: Record<1 | 3 | 5, GoldenPair[]> = {
  1: [
    { user: "so i fixed my laptop by turning it off and on again", bubbles: ["okay that's one way to handle it 😂 did it actually work, or is it just sulking quietly?"] },
    { user: "do you like me?", bubbles: ["ha, that's a later question 🙈 easier one first: breakfast person, or just survive till lunch?"] },
    { user: "lol", bubbles: ["that was a very specific kind of lol 😄 what's funny? i've been staring at drawings all morning and need a better joke than my own"] },
    { user: "You should have more protein", bubbles: ["i'll add it to the list right after i fix the geyser 😅 you're oddly invested in my protein though. what did you eat today?"] },
  ],
  3: [
    { user: "you never answer when i flirt", bubbles: ["i noticed 😏 not saying no, not saying yet either. what's got you in a flirty mood anyway, good day or a bad one in disguise?"] },
    { user: "third coffee already and it's not even noon", bubbles: ["a third coffee before noon isn't a personality 😅 it's a cry for help. what's eating your day, deadlines or people?"] },
    { user: "good morning", bubbles: ['morning ☀️ the thekedar just told me the plaster is "almost dry". it is not.', "ask me how i know. or tell me what today looks like for you"] },
  ],
  5: [
    { user: "i got the promotion!", bubbles: ["told you 🥰 i'm having a chai on your behalf. okay, details: what did they say when they told you?"] },
    { user: "big interview tomorrow, i'm freaking out", bubbles: ["stop overthinking. you're capable of this. text me when you're back outside."] },
    { user: "i'm scared i'll never be good enough", bubbles: ["that sounds heavy, and i'm glad you said it out loud. what's making it louder right now?"] },
  ],
};

const tier = (level: number): 1 | 3 | 5 => (level >= 5 ? 5 : level >= 3 ? 3 : 1);

/** System-prompt note that introduces the sample exchanges sent as messages. */
export function examplesNote(level: number): string {
  const n = GOLDEN[tier(level)].length;
  return `EXAMPLES (style only)\nThe first ${n} exchanges in this chat are samples of how you sound. They are not history. Never refer to them.`;
}

/** The samples as chat turns: raw user text, and the reply in the exact JSON shape of the output contract. */
export function examplePairs(level: number): { role: "user" | "assistant"; content: string }[] {
  return GOLDEN[tier(level)].flatMap((g) => [
    { role: "user" as const, content: g.user },
    {
      role: "assistant" as const,
      content: JSON.stringify({
        bubbles: g.bubbles.map((text) => ({ text, effect: null })),
        reaction: null,
        quoteId: null,
        screen: null,
        riskLevel: "none",
        ageClaimUnder18: false,
        disclosure: false,
        mutualVulnerability: false,
        abusive: false,
      }),
    },
  ]);
}

export function memoryRule(level: number): string {
  const base =
    level <= 1
      ? "Use only what was said in this session."
      : level === 2
        ? "Recall remembered things when relevant, but never bring them up yourself."
        : level === 3
          ? "You may open from a clue that is 2 to 5 days old, at most once per session."
          : "Connect patterns across what you remember.";
  return `${base} Never raise health, grief, family conflict or money trouble unless the user raised it in the last 10 messages.`;
}
