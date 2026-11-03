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
import rawF06 from "./F06.persona.json";
import rawF10 from "./F10.persona.json";
import rawF12 from "./F12.persona.json";
import rawF14 from "./F14.persona.json";
import rawF15 from "./F15.persona.json";
import rawF16 from "./F16.persona.json";
import rawM11 from "./M11.persona.json";
import rawM12 from "./M12.persona.json";
import rawM13 from "./M13.persona.json";
import rawM14 from "./M14.persona.json";
import rawM15 from "./M15.persona.json";
import rawM16 from "./M16.persona.json";
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

export const F06: Persona = rawF06 as Persona;
export const F10: Persona = rawF10 as Persona;
export const F12: Persona = rawF12 as Persona;
export const F14: Persona = rawF14 as Persona;
export const F15: Persona = rawF15 as Persona;
export const F16: Persona = rawF16 as Persona;
export const M11: Persona = rawM11 as Persona;
export const M12: Persona = rawM12 as Persona;
export const M13: Persona = rawM13 as Persona;
export const M14: Persona = rawM14 as Persona;
export const M15: Persona = rawM15 as Persona;
export const M16: Persona = rawM16 as Persona;

export const PERSONAS: Record<string, Persona> = { F01, F02, F03, F04, F05, F06, F07, F08, F09, F10, F11, F12, F13, F14, F15, F16, M01, M02, M03, M04, M05, M06, M07, M08, M09, M10, M11, M12, M13, M14, M15, M16 };

// LIVE_TEMPLATES, LiveAudience and brainOf live in ./liveTemplates so client code can use them without pulling in every persona file.
export { LIVE_TEMPLATES, brainOf, type LiveAudience } from "./liveTemplates";

/** Throws on an unknown template; callers only reach it for live companions. */
export function personaFor(templateId: string): Persona {
  const p = PERSONAS[templateId];
  if (!p) throw new Error(`No persona for template ${templateId}`);
  return p;
}
