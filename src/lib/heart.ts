/**
 * B2 "heart" (spec 4.7): what Ira is doing right now. Mood, time block,
 * season, arc month and milestones, all derived from the IST clock and the
 * companion id, so the same day always reads the same. Pure.
 */

import { F01, type Persona } from "@/personas/persona";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86400000;

export interface IstParts {
  dayKey: string;
  year: number;
  month: number; // 1..12
  dom: number;
  weekday: number; // 0 = Sunday
  hour: number;
  minute: number;
  minuteOfDay: number;
}

export function istNow(ms: number): IstParts {
  const d = new Date(ms + IST_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const dom = d.getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    dayKey: `${year}-${p(month)}-${p(dom)}`,
    year,
    month,
    dom,
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
// Time block
// ---------------------------------------------------------------------------

/**
 * Start of each row of Appendix A's `weekday` table, in IST minutes:
 * 6:45, 7:30, 8:30, 10:30, 14:00, 15:30, 19:30, 21:30. The sheet's own
 * gaps (10:00 to 10:30 and 3:00 to 3:30) belong to the block before them,
 * and 1:00 to 6:45 is the asleep stretch that belongs to no row.
 */
const BLOCK_STARTS = [405, 450, 510, 630, 840, 930, 1170, 1290];
const NIGHT_END = 60; // 1:00
const EVENING_START = 1170; // 19:30, where the weekend joins the weekday table again

export interface TimeBlock {
  /** Row index in `weekday`, or -1 for the asleep stretch. */
  row: number;
  presence: string;
  activity: string;
  /** Key into `contextCards`. */
  card: string;
}

export function timeBlock(ist: IstParts, persona: Persona = F01): TimeBlock {
  const m = ist.minuteOfDay;
  const weekend = ist.weekday === 0 || ist.weekday === 6;

  // 0:00 to 1:00 is still the balcony block of the evening before.
  if (m < NIGHT_END) return blockFromRow(7, ist, persona);
  if (m < BLOCK_STARTS[0]) {
    return { row: -1, presence: "Asleep", activity: "Asleep.", card: "Morning" };
  }
  let row = 0;
  for (let i = 0; i < BLOCK_STARTS.length; i++) if (m >= BLOCK_STARTS[i]) row = i;

  if (weekend && m < EVENING_START) {
    const plan = persona.week[(ist.weekday + 6) % 7].plan;
    return { row: -1, presence: "Open", activity: plan, card: m < 840 ? "Morning" : "Lunch" };
  }
  return blockFromRow(row, ist, persona);
}

function blockFromRow(row: number, ist: IstParts, persona: Persona): TimeBlock {
  const r = persona.weekday[row];
  const siteDay = ist.weekday === 2 || ist.weekday === 4;
  const cards = ["Morning", "Morning", "Commute", siteDay ? "Site" : "Studio", "Lunch", "Studio", "Night", "Night"];
  return { row, presence: r.presence, activity: r.activity, card: cards[row] };
}

// ---------------------------------------------------------------------------
// Mood
// ---------------------------------------------------------------------------

function hashString(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Weight of each mood on a given IST day. Season- and weekday-bound moods
 * ("Site day", "Fog slow", "Smog shutdown", "Missing Nani's house") carry
 * weight 0 outside their window; everything else weighs 1 unless boosted.
 */
export function moodWeight(mood: string, ist: IstParts): number {
  const { weekday, month, dom, year } = ist;
  const lastThree = dom > daysInMonth(year, month) - 3;
  switch (mood) {
    case "Site day":
      return weekday === 2 || weekday === 4 ? 4 : 0;
    case "Principal pressure":
      return weekday === 1 ? 4 : 1;
    case "Budget close":
      return weekday === 5 || lastThree ? 4 : 1;
    case "Fog slow":
      return month === 12 || month === 1 ? 3 : 0;
    case "Smog shutdown":
      return month === 11 && dom <= 20 ? 3 : 0;
    case "Missing Nani's house":
      return weekday === 0 ? 2 : 0;
    default:
      return 1;
  }
}

export interface Mood {
  mood: string;
  texting: string;
  line: string;
}

/** Deterministic per companion per IST day. */
export function moodFor(companionId: string, ist: IstParts, persona: Persona = F01): Mood {
  const weights = persona.moods.map((m) => moodWeight(m.mood, ist));
  const total = weights.reduce((a, b) => a + b, 0);
  const rnd = mulberry32(hashString(companionId + ist.dayKey))();
  let pick = rnd * total;
  let idx = 0;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] === 0) continue;
    idx = i;
    if (pick < weights[i]) break;
    pick -= weights[i];
  }
  const m = persona.moods[idx];
  return { mood: m.mood, texting: m.texting, line: m.line };
}

// ---------------------------------------------------------------------------
// Season, arc, milestones
// ---------------------------------------------------------------------------

export function seasonFor(month: number, persona: Persona = F01): string {
  const i = month === 1 ? 0 : month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : month <= 11 ? 4 : 5;
  return persona.seasons[i].texture;
}

/** `floor(relationshipDay / 30) + 1`, capped at 12, then repeating from 7. */
export function arcMonth(relationshipDay: number): number {
  const m = Math.floor(relationshipDay / 30) + 1;
  return m <= 12 ? m : 7 + ((m - 13) % 6);
}

export function arcBeat(relationshipDay: number, persona: Persona = F01): string {
  const month = arcMonth(relationshipDay);
  return persona.arc.find((a) => a.month === month)?.beat ?? "";
}

export type ScreenKind = "confetti" | "lanterns" | "rain" | "petals";

export interface Milestone {
  kind: "level6" | "birthday" | "diwali" | "anniversary" | "rain";
  screen: ScreenKind;
  /** Prompt line for the day, or null when nothing needs saying. */
  note: string;
}

const DIWALI = ["2026-11-08", "2027-10-29"];

const RAIN_RE = /\b(rain|raining|rained|rainy|barish|baarish|monsoon)\b/i;

export function mentionsRain(texts: string[]): boolean {
  return texts.some((t) => RAIN_RE.test(t));
}

/**
 * Days that allow a screen effect. The user's own birthday is out of scope
 * (the date of birth is not stored).
 */
export function milestoneFor(args: {
  ist: IstParts;
  createdDayKey: string;
  relationshipDay: number;
  rainMentioned: boolean;
  leveledUp: number | null;
}): Milestone | null {
  const { ist } = args;
  if (args.leveledUp === 6) return { kind: "level6", screen: "petals", note: "You and the user just became intimate partners. This is a moment." };
  if (ist.month === 3 && ist.dom === 27) return { kind: "birthday", screen: "confetti", note: "It is your birthday today (27 March)." };
  if (DIWALI.includes(ist.dayKey)) return { kind: "diwali", screen: "lanterns", note: "It is Diwali today." };
  if (args.relationshipDay >= 365 && args.createdDayKey.slice(5) === ist.dayKey.slice(5)) {
    return { kind: "anniversary", screen: "confetti", note: "It is one year since you and the user met." };
  }
  if (ist.month === 7 && ist.dom === 1 && args.rainMentioned) {
    return { kind: "rain", screen: "rain", note: "First of July, and the user mentioned rain." };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Context card and the combined "right now"
// ---------------------------------------------------------------------------

export function contextCardKey(block: TimeBlock, mood: Mood, levelChangedSinceCard: boolean): string {
  if (levelChangedSinceCard) return "Level-up";
  if (mood.mood === "Fog slow") return "Fog day";
  if (mood.mood === "Smog shutdown") return "Smog day";
  return block.card;
}

export interface HeartNow {
  ist: IstParts;
  block: TimeBlock;
  mood: Mood;
  season: string;
  relationshipDay: number;
  arcMonth: number;
  arcBeat: string;
  weekdayPlan: string;
}

export function now(
  companion: { id: string; createdAt: number },
  ms: number,
  persona: Persona = F01
): HeartNow {
  const ist = istNow(ms);
  const created = istNow(companion.createdAt);
  const relationshipDay = Math.max(
    0,
    Math.round((Date.UTC(ist.year, ist.month - 1, ist.dom) - Date.UTC(created.year, created.month - 1, created.dom)) / DAY_MS)
  );
  return {
    ist,
    block: timeBlock(ist, persona),
    mood: moodFor(companion.id, ist, persona),
    season: seasonFor(ist.month, persona),
    relationshipDay,
    arcMonth: arcMonth(relationshipDay),
    arcBeat: arcBeat(relationshipDay, persona),
    weekdayPlan: persona.week[(ist.weekday + 6) % 7].plan,
  };
}
