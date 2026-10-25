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

export interface GoldenPair {
  user: string;
  bubbles: string[];
}

/** One mood's weight window. It matches if any of its conditions holds; moods without a rule weigh 1. */
export interface MoodRule {
  mood: string;
  weekdays?: number[];
  months?: number[];
  /** "MM-DD"; from/to may wrap the year (12-21 to 01-31). */
  from?: string;
  to?: string;
  /** Matches the last N days of the month. */
  lastDays?: number;
  on: number;
  off: number;
}

/** Everything the engine used to hardcode for Ira. Times are "H:MM" IST. */
export interface PersonaEngine {
  city: string;
  emojiVoice: string;
  blockStarts: string[];
  nightEnd: string;
  cards: string[];
  cardOverrides: { row: number; weekdays: number[]; card: string }[];
  energy: Record<string, string>;
  moodRules: MoodRule[];
  gatedMoods: Record<string, number>;
  specialCards: Record<string, string>;
  hardRules: string[];
  /** Names of her people; lint flags one used without an introduction. */
  people: string[];
  /** The open-loop example in CONVERSATION OWNERSHIP, in her own world. */
  openLoop: string;
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
  golden: Record<"1" | "3" | "5", GoldenPair[]>;
  engine: PersonaEngine;
}

/** Kept for back-compat; runtime code takes its persona from the registry. */
export const F01: Persona = raw as Persona;

/** The reaction palette for a trust level. */
export function paletteFor(level: number, persona: Persona): string[] {
  return persona.reactionPalette[String(level)] ?? persona.reactionPalette["1"];
}
