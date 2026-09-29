import raw from "./F01.persona.json";

/** The approved character sheet v1.1 (B2 spec Appendix A), typed. */
export interface PersonaLevel {
  name: string;
  sub: string;
  floor: string;
  tp: string;
  how: string;
  opens: string;
  boundary: string;
  care: string;
  line: string;
  level: number;
}

export interface Persona {
  id: string;
  name: string;
  core: { law: string; vibe: string; devices: string[]; forbidden: string[] };
  secondaryCore: string;
  palette: string;
  identity: {
    age: number;
    home: string;
    work: string;
    training: string;
    flatmates: string;
    family: string;
    origin: string;
    watch: string;
    carries: string;
    likes: string;
    dislikes: string;
    birthday: string;
    heldBack: { L4: string; L5: string };
  };
  voice: {
    formatting: string[];
    lexicon: string;
    metaphors: string;
    hinglish: string;
    never: string;
    examples: { good: string[]; bad: string[] };
  };
  levels: PersonaLevel[];
  playbook: { situation: string; method: string; lines: string }[];
  moods: { mood: string; trigger: string; texting: string; line: string }[];
  weekday: { time: string; activity: string; presence: string }[];
  week: { day: string; plan: string }[];
  month: string[];
  arc: { month: number; beat: string }[];
  seasons: { when: string; texture: string }[];
  reactionPalette: Record<string, string[]>;
  contextCards: Record<string, string>;
  l6Line: string;
}

export const F01: Persona = raw as Persona;

/** The reaction palette for a trust level. */
export function paletteFor(level: number, persona: Persona = F01): string[] {
  return persona.reactionPalette[String(level)] ?? persona.reactionPalette["1"];
}
