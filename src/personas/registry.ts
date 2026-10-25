import raw02 from "./F02.persona.json";
import { F01, type Persona } from "./persona";

export const F02: Persona = raw02 as Persona;

export const PERSONAS: Record<string, Persona> = { F01, F02 };

/** Who may talk to the live model: everyone, or only accounts with role admin or qa. Mirrored in SQL by ally_private.is_live(). */
export const LIVE_TEMPLATES = { F01: "all", F02: "qa" } as const;

export type LiveAudience = (typeof LIVE_TEMPLATES)[keyof typeof LIVE_TEMPLATES];

/** Throws on an unknown template; callers only reach it for live companions. */
export function personaFor(templateId: string): Persona {
  const p = PERSONAS[templateId];
  if (!p) throw new Error(`No persona for template ${templateId}`);
  return p;
}
