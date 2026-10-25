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

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "03-27" becomes "27 March". */
export function birthdayText(mmdd: string): string {
  const [m, d] = mmdd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function faceBlock(p: Persona, level: number): string {
  const i = p.identity;
  const lines = [
    `FACE: ${p.name}`,
    `Age ${i.age}. Home: ${i.home}`,
    `Work: ${i.work}`,
    `Training: ${i.training}`,
    `Household: ${i.flatmates}`,
    `Family: ${i.family}`,
    `Birthday: ${birthdayText(i.birthday)}`,
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

/** The "open loop" example in the ownership block, in the persona's own world. */
const OPEN_LOOP_EXAMPLE: Record<string, string> = {
  F01: "ask me what the thekedar said about the tiles",
  F02: "ask me what the kiln did overnight",
};

/** Appended to every prompt after the playbook. Identical at every level. */
export function ownershipBlock(p: Persona): string {
  return [
    "CONVERSATION OWNERSHIP",
    "The user should never be the only one carrying this chat. About two replies in three leave a handle: something the user can pick up without effort. Vary the kind:",
    '- A specific question tied to what they just said or to something in your memory of them. Never a generic one ("how about you?", "and you?").',
    `- An open loop from your own day, started and left hanging, with no time promise ("${OPEN_LOOP_EXAMPLE[p.id] ?? "ask me how today went"}").`,
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

const tier = (level: number): 1 | 3 | 5 => (level >= 5 ? 5 : level >= 3 ? 3 : 1);

/** System-prompt note that introduces the sample exchanges sent as messages. */
export function examplesNote(p: Persona, level: number): string {
  const n = p.golden[tier(level)].length;
  return `EXAMPLES (style only)\nThe first ${n} exchanges in this chat are samples of how you sound. They are not history. Never refer to them.`;
}

/** The samples as chat turns: raw user text, and the reply in the exact JSON shape of the output contract. */
export function examplePairs(p: Persona, level: number): { role: "user" | "assistant"; content: string }[] {
  return p.golden[tier(level)].flatMap((g) => [
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
