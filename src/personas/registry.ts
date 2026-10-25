import raw02 from "./F02.persona.json";
import raw03 from "./F03.persona.json";
import raw04 from "./F04.persona.json";
import raw05 from "./F05.persona.json";
import raw07 from "./F07.persona.json";
import raw08 from "./F08.persona.json";
import raw09 from "./F09.persona.json";
import raw11 from "./F11.persona.json";
import raw13 from "./F13.persona.json";
import { CORE_MAP } from "@/lib/coreMap";
import type { CoreId } from "@/state/schema";
import { F01, type Persona } from "./persona";

export const F02: Persona = raw02 as Persona;
export const F03: Persona = raw03 as Persona;
export const F04: Persona = raw04 as Persona;
export const F05: Persona = raw05 as Persona;
export const F07: Persona = raw07 as Persona;
export const F08: Persona = raw08 as Persona;
export const F09: Persona = raw09 as Persona;
export const F11: Persona = raw11 as Persona;
export const F13: Persona = raw13 as Persona;

export const PERSONAS: Record<string, Persona> = { F01, F02, F03, F04, F05, F07, F08, F09, F11, F13 };

/** Who may talk to the live model: everyone, or only accounts with role admin or qa. Mirrored in SQL by ally_private.live_faces(). */
export const LIVE_TEMPLATES = { F01: "all", F02: "qa", F03: "qa", F04: "qa", F05: "qa", F07: "qa", F08: "qa", F09: "qa", F11: "qa", F13: "qa" } as const;

export type LiveAudience = (typeof LIVE_TEMPLATES)[keyof typeof LIVE_TEMPLATES];

/** A face's brain is its primary core in CORE_MAP (D1). Throws on an unknown template. */
export function brainOf(templateId: string): CoreId {
  const entry = CORE_MAP[templateId];
  if (!entry) throw new Error(`No core for template ${templateId}`);
  return entry[0];
}

/** Throws on an unknown template; callers only reach it for live companions. */
export function personaFor(templateId: string): Persona {
  const p = PERSONAS[templateId];
  if (!p) throw new Error(`No persona for template ${templateId}`);
  return p;
}
