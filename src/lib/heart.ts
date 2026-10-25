/**
 * B2 "heart" (spec 4.7): what a companion is doing right now. Mood, time block,
 * season, arc month and milestones, all derived from the IST clock and the
 * companion id, so the same day always reads the same. Pure.
 */

import type { MoodRule, Persona } from "@/personas/persona";
import { birthdayText } from "@/personas/cores/romantic";

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

/** "H:MM" to minutes. */
function minutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/** The weekend joins the weekday table again at the evening row (blockStarts[6]); before 14:00 it is "Morning", after it "Lunch". */
const WEEKEND_LUNCH = 840;

export interface TimeBlock {
  /** Row index in `weekday`, or -1 for the asleep stretch. */
  row: number;
  presence: string;
  activity: string;
  /** Key into `contextCards`. */
  card: string;
}

/**
 * Rows follow `persona.engine.blockStarts`. The sheet's own gaps belong to the
 * block before them, and nightEnd to the first block start is the asleep
 * stretch that belongs to no row.
 *
 * A block start of "24:00" or later ("24:30", "25:30") is after midnight and
 * still belongs to the evening before. minutes() returns values past 1440 for
 * these, and the small hours up to nightEnd (an ordinary clock time such as
 * "3:45") are shifted by 1440 to sort after them.
 */
export function timeBlock(ist: IstParts, persona: Persona): TimeBlock {
  const e = persona.engine;
  const starts = e.blockStarts.map(minutes);
  const nightEnd = minutes(e.nightEnd);
  const m = ist.minuteOfDay;
  const weekend = ist.weekday === 0 || ist.weekday === 6;

  // The small hours belong to the night before: shift them past 24:00 so they sort after the last block start.
  const mm = m < nightEnd ? m + 1440 : m;
  if (mm < starts[0]) {
    return { row: -1, presence: "Asleep", activity: "Asleep.", card: "Morning" };
  }
  let row = 0;
  for (let i = 0; i < starts.length; i++) if (mm >= starts[i]) row = i;

  if (weekend && mm < starts[6]) {
    const plan = persona.week[(ist.weekday + 6) % 7].plan;
    return { row: -1, presence: "Open", activity: plan, card: m < WEEKEND_LUNCH ? "Morning" : "Lunch" };
  }
  return blockFromRow(row, ist, persona);
}

function blockFromRow(row: number, ist: IstParts, persona: Persona): TimeBlock {
  const r = persona.weekday[row];
  const override = persona.engine.cardOverrides.find((o) => o.row === row && o.weekdays.includes(ist.weekday));
  return { row, presence: r.presence, activity: r.activity, card: override?.card ?? persona.engine.cards[row] };
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

function inDateRange(month: number, dom: number, from: string, to: string): boolean {
  const key = month * 100 + dom;
  const [fm, fd] = from.split("-").map(Number);
  const [tm, td] = to.split("-").map(Number);
  const lo = fm * 100 + fd;
  const hi = tm * 100 + td;
  return lo <= hi ? key >= lo && key <= hi : key >= lo || key <= hi;
}

function ruleMatches(r: MoodRule, ist: IstParts): boolean {
  const { weekday, month, dom, year } = ist;
  if (r.weekdays?.includes(weekday)) return true;
  if (r.months?.includes(month)) return true;
  if (r.from && r.to && inDateRange(month, dom, r.from, r.to)) return true;
  if (r.lastDays !== undefined && dom > daysInMonth(year, month) - r.lastDays) return true;
  return false;
}

/**
 * Weight of a mood on a given IST day: the persona's rule (`on` when any of
 * its conditions holds, `off` otherwise), or 1 for a mood without a rule.
 */
export function moodWeight(mood: string, ist: IstParts, persona: Persona): number {
  const rule = persona.engine.moodRules.find((r) => r.mood === mood);
  if (!rule) return 1;
  return ruleMatches(rule, ist) ? rule.on : rule.off;
}

export interface Mood {
  mood: string;
  texting: string;
  line: string;
}

/** Deterministic per companion per IST day. */
export function moodFor(companionId: string, ist: IstParts, persona: Persona): Mood {
  const weights = persona.moods.map((m) => moodWeight(m.mood, ist, persona));
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

export function seasonFor(month: number, persona: Persona): string {
  const i = month === 1 ? 0 : month <= 3 ? 1 : month <= 6 ? 2 : month <= 9 ? 3 : month <= 11 ? 4 : 5;
  return persona.seasons[i].texture;
}

/** `floor(relationshipDay / 30) + 1`, capped at 12, then repeating from 7. */
export function arcMonth(relationshipDay: number): number {
  const m = Math.floor(relationshipDay / 30) + 1;
  return m <= 12 ? m : 7 + ((m - 13) % 6);
}

export function arcBeat(relationshipDay: number, persona: Persona): string {
  const month = arcMonth(relationshipDay);
  return persona.arc.find((a) => a.month === month)?.beat ?? "";
}

export type ScreenKind = "confetti" | "lanterns" | "rain" | "petals" | "balloons" | "fireworks" | "shootingstar" | "sparkles";

export interface Milestone {
  kind: "level6" | "birthday" | "diwali" | "anniversary" | "rain" | "msg100";
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
  /** Every message the user has ever sent this companion, deleted ones included, so it only ever grows. */
  userMsgCount?: number;
  persona: Persona;
}): Milestone | null {
  const { ist } = args;
  if (args.leveledUp === 6) return { kind: "level6", screen: "petals", note: "You and the user just became intimate partners. This is a moment." };
  const [bm, bd] = args.persona.identity.birthday.split("-").map(Number);
  if (ist.month === bm && ist.dom === bd) {
    return { kind: "birthday", screen: "confetti", note: `It is your birthday today (${birthdayText(args.persona.identity.birthday)}).` };
  }
  if (DIWALI.includes(ist.dayKey)) return { kind: "diwali", screen: "lanterns", note: "It is Diwali today." };
  if (args.relationshipDay >= 365 && args.createdDayKey.slice(5) === ist.dayKey.slice(5)) {
    return { kind: "anniversary", screen: "confetti", note: "It is one year since you and the user met." };
  }
  if (ist.month === 7 && ist.dom === 1 && args.rainMentioned) {
    return { kind: "rain", screen: "rain", note: "First of July, and the user mentioned rain." };
  }
  if (args.userMsgCount === 100) return { kind: "msg100", screen: "balloons", note: "That was the 100th message the user has sent you." };
  return null;
}

// ---------------------------------------------------------------------------
// Context card and the combined "right now"
// ---------------------------------------------------------------------------

export function contextCardKey(block: TimeBlock, mood: Mood, levelChangedSinceCard: boolean, persona: Persona): string {
  if (levelChangedSinceCard) return "Level-up";
  return persona.engine.specialCards[mood.mood] ?? block.card;
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
  persona: Persona
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
