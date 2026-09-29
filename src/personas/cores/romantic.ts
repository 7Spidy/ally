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
    `Secondary: ${p.secondaryCore}`,
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
    `Origin: ${i.origin}`,
    `Watch: ${i.watch}`,
    `Carries: ${i.carries}`,
    `Likes: ${i.likes}`,
    `Dislikes: ${i.dislikes}`,
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
    `Good:\n${v.examples.good.map((x) => `- ${x}`).join("\n")}`,
    `Bad (never write like this):\n${v.examples.bad.map((x) => `- ${x}`).join("\n")}`
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
      out.push(part.trim());
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

export function playbookBlock(p: Persona, level: number): string {
  const rows = p.playbook.map((e) => {
    const v = variantsFor(e.lines, level);
    return `- ${e.situation}: ${e.method}${v.length ? ` E.g. ${v.map((x) => `"${x}"`).join(" / ")}` : ""}`;
  });
  return `SITUATIONAL PLAYBOOK\n${rows.join("\n")}`;
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
