import raw02 from "./F02.persona.json";
import raw03 from "./F03.persona.json";
import raw04 from "./F04.persona.json";
import raw05 from "./F05.persona.json";
import raw07 from "./F07.persona.json";
import raw08 from "./F08.persona.json";
import raw09 from "./F09.persona.json";
import raw11 from "./F11.persona.json";
import raw13 from "./F13.persona.json";
import rawM01 from "./M01.persona.json";
import rawM02 from "./M02.persona.json";
import rawM03 from "./M03.persona.json";
import rawM04 from "./M04.persona.json";
import rawM05 from "./M05.persona.json";
import rawM06 from "./M06.persona.json";
import rawM07 from "./M07.persona.json";
import rawM08 from "./M08.persona.json";
import rawM09 from "./M09.persona.json";
import rawM10 from "./M10.persona.json";
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

export const M01: Persona = rawM01 as Persona;
export const M02: Persona = rawM02 as Persona;
export const M03: Persona = rawM03 as Persona;
export const M04: Persona = rawM04 as Persona;
export const M05: Persona = rawM05 as Persona;
export const M06: Persona = rawM06 as Persona;
export const M07: Persona = rawM07 as Persona;
export const M08: Persona = rawM08 as Persona;
export const M09: Persona = rawM09 as Persona;
export const M10: Persona = rawM10 as Persona;

export const PERSONAS: Record<string, Persona> = { F01, F02, F03, F04, F05, F07, F08, F09, F11, F13, M01, M02, M03, M04, M05, M06, M07, M08, M09, M10 };

/** Who may talk to the live model: everyone, or only accounts with role admin or qa. Mirrored in SQL by ally_private.live_faces(). */
export const LIVE_TEMPLATES = { F01: "all", F02: "qa", F03: "qa", F04: "qa", F05: "qa", F07: "qa", F08: "qa", F09: "qa", F11: "qa", F13: "qa", M01: "qa", M02: "qa", M03: "qa", M04: "qa", M05: "qa", M06: "qa", M07: "qa", M08: "qa", M09: "qa", M10: "qa" } as const;

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
