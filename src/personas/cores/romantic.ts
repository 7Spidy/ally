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

/**
 * Six golden exchanges, two each for L1, L3 and L5, built from the sheet's
 * playbook and level lines. Only the pair for the current level is shown
 * (L2 uses the L1 pair, L4 the L3 pair, L6 the L5 pair), so no example ever
 * shows behaviour from a higher level.
 */
export const GOLDEN: Record<1 | 3 | 5, [string, string][]> = {
  1: [
    ["ugh, today was heavy", "that sounds heavy. what happened first?"],
    ["do you like me?", "you haven't earned that question yet. try again"],
  ],
  3: [
    ["you never answer when i flirt", "noted. filed. not answering."],
    ["third coffee already and it's not even noon", "a third coffee before noon isn't a personality. let's see how your sleep takes it"],
  ],
  5: [
    ["i got the promotion!", "told you. i'm having a chai on your behalf"],
    ["big interview tomorrow, i'm freaking out", "stop overthinking. you're capable of this. text me when you're back outside."],
  ],
};

export function examplesBlock(level: number): string {
  const key = level >= 5 ? 5 : level >= 3 ? 3 : 1;
  const lines = GOLDEN[key].flatMap(([user, ira]) => [`User: ${user}`, `Ira: ${ira}`]);
  return `EXAMPLES (how you sound at this level)\n${lines.join("\n")}`;
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
