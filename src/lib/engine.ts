/**
 * Matching, deck building and ordering, dwell, propose, age gate, location
 * resolution. No DOM, no storage, no Date() — every external input is a
 * parameter. Deck ordering, dwell and propose are ported from `#ally-engine`
 * in ally-onboarding.html. B1 replaced the six-core distance matcher with
 * five cores scored by direct points, and bound each deck to the user's core.
 */

import type { CoreId, Pressure, Gender, Answers } from "@/state/schema";
import { DECK_HIDDEN, castsAs } from "@/lib/coreMap";

// ---- Cores. Hardcoded by contract. Never shown to the user. ----
export const PRESSURES: Pressure[] = ["money", "health", "head", "alone", "notgood", "change"];
export const INTEREST_TAGS = ["music", "food", "outdoors", "making", "movement", "screen", "systems", "people"] as const;

// ---- Templates (manifest shape) ----
export interface Template {
  id: string;
  name: string;
  gender: Gender;
  region: string;
  city: string;
  age: number;
  palette: string;
  palette_name: string;
  occupation: string;
  read: string;
  technical: boolean;
  interests: string[];
  source_file: string;
  portrait: string;
  avatar: string;
  reveal: string;
  video: string;
  video_file: string;
}

export interface Manifest {
  version: string;
  count: number;
  interest_vocabulary: Record<string, string>;
  templates: Template[];
}

// ---- Matching: direct points per answer, five cores ----

/** Stable sort order for equal scores. ROMANTIC first means it wins every exact tie it is part of. */
export const CORE_ORDER: readonly CoreId[] = ["ROMANTIC", "PSYCH", "FRIEND", "MONEY", "TRAINER"];

/** Points each option of q5..q9 adds, indexed by the chosen option 0..3. */
export const SCORE: Record<"q5" | "q6" | "q7" | "q8" | "q9", Partial<Record<CoreId, number>>[]> = {
  q5: [{ ROMANTIC: 2, PSYCH: 1 }, { ROMANTIC: 2, PSYCH: 1 }, { PSYCH: 2, FRIEND: 1 }, { FRIEND: 2, TRAINER: 1 }],
  q6: [{ ROMANTIC: 2, PSYCH: 1 }, { FRIEND: 2, ROMANTIC: 1 }, { PSYCH: 2, MONEY: 1 }, { MONEY: 2, TRAINER: 1 }],
  q7: [{ PSYCH: 2, ROMANTIC: 1 }, { ROMANTIC: 2 }, { FRIEND: 2 }, { TRAINER: 2, MONEY: 1 }],
  q8: [{ FRIEND: 2, ROMANTIC: 1 }, { ROMANTIC: 2, PSYCH: 1 }, { MONEY: 2, PSYCH: 1 }, { TRAINER: 2, MONEY: 1 }],
  q9: [{ PSYCH: 2 }, { FRIEND: 2 }, { ROMANTIC: 2 }, { TRAINER: 2, MONEY: 1 }],
};
export const PRESSURE_OWNER: Record<Pressure, CoreId> = {
  money: "MONEY",
  health: "TRAINER",
  head: "PSYCH",
  alone: "ROMANTIC",
  notgood: "FRIEND",
  change: "FRIEND",
};
export const PRESSURE_POINTS = 3;
export const TIEBREAK_POINTS = 3;
export const CLOSE_MARGIN = 2; // top minus second below this is a close call
/** A support core is only named when it trails the primary by no more than this. */
export const SECONDARY_MARGIN = 3;

const SCORED_QUESTIONS = ["q5", "q6", "q7", "q8", "q9"] as const;

export interface RankedCore {
  id: CoreId;
  score: number;
}

export function scoreCores(a: Answers): RankedCore[] {
  const totals: Record<CoreId, number> = { ROMANTIC: 0, PSYCH: 0, MONEY: 0, TRAINER: 0, FRIEND: 0 };
  for (const q of SCORED_QUESTIONS) {
    const pick = a[q];
    if (pick == null) continue;
    const points = SCORE[q][pick];
    if (!points) continue; // not an option index; a stale pre-B1 float scores nothing
    for (const [core, pts] of Object.entries(points) as [CoreId, number][]) totals[core] += pts;
  }
  if (a.q10) totals[PRESSURE_OWNER[a.q10]] += PRESSURE_POINTS;
  if (a.tb) totals[a.tb] += TIEBREAK_POINTS;
  return CORE_ORDER.map((id) => ({ id, score: totals[id] })).sort(
    (x, y) => y.score - x.score || CORE_ORDER.indexOf(x.id) - CORE_ORDER.indexOf(y.id)
  );
}

/** The two cores to put to the user when the top of the ranking is a close call, else null. */
export function needsTiebreak(ranked: RankedCore[], a: Answers): [CoreId, CoreId] | null {
  if (a.tb) return null;
  const [first, second] = ranked;
  if (!first || !second) return null;
  const gap = first.score - second.score;
  if (gap === 0 && (first.id === "ROMANTIC" || second.id === "ROMANTIC")) return null;
  return gap < CLOSE_MARGIN ? [first.id, second.id] : null;
}

export interface AssignedCore {
  primary: CoreId;
  secondary: CoreId | null;
  weight: 100 | 70;
}

export function assignCore(ranked: RankedCore[]): AssignedCore {
  const [first] = ranked;
  // Romantic never supports.
  const support = ranked.slice(1).find((r) => r.id !== "ROMANTIC");
  if (support && first.score - support.score <= SECONDARY_MARGIN) {
    return { primary: first.id, secondary: support.id, weight: 70 };
  }
  return { primary: first.id, secondary: null, weight: 100 };
}

export interface ComputedCore extends AssignedCore {
  ranked: RankedCore[];
}

export function computeCore(answers: Answers): ComputedCore {
  const ranked = scoreCores(answers);
  return { ...assignCore(ranked), ranked };
}

// ---- Deck ----

/**
 * Gender is the base filter; `core` keeps only faces cast for that core
 * (minus `DECK_HIDDEN`); `excluded` removes active/parted faces (spec §7.1,
 * §8.3). Omit `core` for a gender-only pool.
 */
export function deckTemplates(templates: Template[], gender: Gender, excluded?: ReadonlySet<string>, core?: CoreId): Template[] {
  return templates.filter(
    (t) =>
      t.gender === gender &&
      !(excluded && excluded.has(t.id)) &&
      (!core || (castsAs(t.id, core) && !DECK_HIDDEN[t.id]?.includes(core)))
  );
}

/** Alias matching §8.3's `pool(templates, gender, excluded)` signature. */
export const pool = deckTemplates;

/**
 * The deck for a user's ranked cores: their core's deck, else the next
 * ranked core's, and so on down all five (D4, extended). The user is never
 * told. Every face is cast for at least one core, so this is empty only when
 * the gender's pool is empty. Ordered by `orderDeck` when `user` is given.
 */
export function buildCoreDeck(
  templates: Template[],
  gender: Gender,
  excluded: ReadonlySet<string> | undefined,
  ranked: RankedCore[],
  user?: DeckUser,
  rand?: () => number
): Template[] {
  for (const r of ranked) {
    const deck = deckTemplates(templates, gender, excluded, r.id);
    if (deck.length) return user ? orderDeck(deck, user, rand) : deck;
  }
  return [];
}

export function overlap(tags: string[], picks: string[] | undefined | null): number {
  if (!picks || !picks.length) return 0;
  return picks.filter((p) => tags.includes(p)).length / picks.length;
}

export interface DeckUser {
  region: string | null;
  age: number | null;
  interests: string[];
}

export function orderDeck(templates: Template[], user: DeckUser, rand: () => number = Math.random): Template[] {
  return templates
    .map((t) => ({
      t,
      a:
        (t.region === user.region ? 0.35 : 0) +
        (user.age != null && Math.abs(t.age - user.age) <= 4 ? 0.25 : 0) +
        (user.age != null && Math.abs(t.age - user.age) <= 8 ? 0.1 : 0) +
        overlap(t.interests, user.interests) * 0.3 +
        rand() * 0.12,
    }))
    .sort((x, y) => y.a - x.a)
    .map((x) => x.t);
}

export const DWELL_CAP = 15000;
export const EXPAND_BONUS = 2500;

export function addDwell(dwell: Record<string, number>, id: string, ms: number): Record<string, number> {
  return { ...dwell, [id]: Math.min(DWELL_CAP, (dwell[id] || 0) + ms) };
}

export function dwellWeight(ms: number | undefined): number {
  return Math.pow(Math.min(ms ?? 0, DWELL_CAP) + 500, 0.7);
}

export function propose(pool: string[], dwell: Record<string, number>, rand: () => number = Math.random): string | null {
  if (!pool.length) return null;
  const w = pool.map((id) => dwellWeight(dwell[id] ?? 0));
  const total = w.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < pool.length; i++) if ((r -= w[i]) <= 0) return pool[i];
  return pool[pool.length - 1];
}

/** Highest dwell, ties broken by deck order (stable). */
export function rankByDwell(ids: string[], dwell: Record<string, number>): string[] {
  return ids
    .map((id, i) => ({ id, i, d: dwell[id] ?? 0 }))
    .sort((x, y) => y.d - x.d || x.i - y.i)
    .map((x) => x.id);
}

export interface DeckProposalState {
  liked: string[];
  deckOrder: string[];
  dwell: Record<string, number>;
  poolRemoved?: string[];
  redraws: number;
}

export interface NextProposal {
  proposed: string | null;
  canRedraw: boolean;
  mode: "nolikes" | "single" | "exhausted" | "pool";
}

/** Spec §7.4. Given deck state, decide what to propose and whether a redraw is offered. */
export function nextProposal(st: DeckProposalState, rand: () => number = Math.random): NextProposal {
  const liked = st.liked;
  const deckIds = st.deckOrder;
  const removed = st.poolRemoved || [];
  if (liked.length === 0) {
    const ranking = rankByDwell(deckIds, st.dwell);
    const n = Math.min(st.redraws, 3, ranking.length - 1);
    return { proposed: ranking[n] ?? null, canRedraw: st.redraws < 3 && ranking.length > n + 1, mode: "nolikes" };
  }
  if (liked.length === 1) {
    return { proposed: liked[0], canRedraw: false, mode: "single" };
  }
  const p = liked.filter((id) => !removed.includes(id));
  if (!p.length) {
    return { proposed: rankByDwell(liked, st.dwell)[0] ?? null, canRedraw: false, mode: "exhausted" };
  }
  return { proposed: propose(p, st.dwell, rand), canRedraw: true, mode: "pool" };
}

// ---- Age gate ----
export function ageAt(dobISO: string, today: Date): number {
  const [y, m, d] = dobISO.split("-").map(Number);
  let age = today.getFullYear() - y;
  const mm = today.getMonth() + 1;
  if (mm < m || (mm === m && today.getDate() < d)) age -= 1;
  return age;
}

// ---- Location ----
export const REGION_MAP: Record<string, string[]> = {
  North: ["Delhi", "Noida", "Gurgaon", "Chandigarh", "Jaipur", "Lucknow", "Srinagar", "Amritsar", "Dehradun", "Ludhiana", "Kanpur", "Varanasi", "Agra", "Faridabad", "Ghaziabad"],
  West: ["Mumbai", "Pune", "Ahmedabad", "Surat", "Nagpur", "Nashik", "Panaji", "Rajkot", "Vadodara", "Thane", "Navi Mumbai"],
  East: ["Kolkata", "Bhubaneswar", "Patna", "Ranchi", "Guwahati", "Jamshedpur", "Cuttack", "Siliguri"],
  Northeast: ["Shillong", "Aizawl", "Imphal", "Gangtok", "Itanagar", "Kohima", "Agartala"],
  Central: ["Bhopal", "Indore", "Raipur", "Jabalpur", "Gwalior", "Ujjain"],
  South: ["Bengaluru", "Chennai", "Hyderabad", "Kochi", "Coimbatore", "Mysuru", "Madurai", "Thiruvananthapuram", "Vizag", "Chikmagalur", "Varkala", "Mangaluru", "Tiruchirappalli", "Warangal"],
};

export const COUNTRIES: string[] = [
  "United States", "United Kingdom", "Canada", "Australia", "United Arab Emirates", "Singapore", "Germany", "France",
  "Netherlands", "Ireland", "New Zealand", "Japan", "South Korea", "Malaysia", "Saudi Arabia", "Qatar", "Oman", "Kuwait",
  "Bahrain", "Sri Lanka", "Nepal", "Bangladesh", "Pakistan", "Thailand", "Indonesia", "Philippines", "Vietnam", "Italy",
  "Spain", "Portugal", "Switzerland", "Sweden", "Norway", "Denmark", "Finland", "Poland", "Brazil", "Mexico", "South Africa",
  "Nigeria", "Kenya", "Egypt", "Turkey", "Israel", "China", "Hong Kong",
];

export const ALIASES: Record<string, string> = {
  bangalore: "Bengaluru", bombay: "Mumbai", calcutta: "Kolkata", madras: "Chennai", gurugram: "Gurgaon",
  visakhapatnam: "Vizag", trivandrum: "Thiruvananthapuram", goa: "Panaji", mangalore: "Mangaluru",
  trichy: "Tiruchirappalli", mysore: "Mysuru", usa: "United States", us: "United States", uk: "United Kingdom",
  uae: "United Arab Emirates", dubai: "United Arab Emirates", london: "United Kingdom", "new york": "United States",
};

export const SOMEWHERE_ELSE = "Somewhere else";

interface Place {
  name: string;
  region: string;
}

export const PLACES: Place[] = [
  ...Object.entries(REGION_MAP).flatMap(([region, cities]) => cities.map((name) => ({ name, region }))),
  ...COUNTRIES.map((name) => ({ name, region: "Outside India" })),
];

const PLACE_BY_LOWER = new Map(PLACES.map((p) => [p.name.toLowerCase(), p]));

export function resolveRegion(raw: string | null | undefined): string {
  const q = (raw || "").trim().toLowerCase();
  if (!q || q === SOMEWHERE_ELSE.toLowerCase()) return "Unspecified";
  const hit = PLACE_BY_LOWER.get(q) || PLACE_BY_LOWER.get((ALIASES[q] || "").toLowerCase());
  return hit ? hit.region : "Unspecified";
}

export function suggestPlaces(raw: string | null | undefined, limit = 6): string[] {
  const q = (raw || "").trim().toLowerCase();
  if (!q) return [];
  const starts: string[] = [];
  const contains: string[] = [];
  for (const p of PLACES) {
    const n = p.name.toLowerCase();
    if (n.startsWith(q)) starts.push(p.name);
    else if (n.includes(q)) contains.push(p.name);
  }
  for (const [alias, canon] of Object.entries(ALIASES)) {
    if (alias.startsWith(q) && !starts.includes(canon) && !contains.includes(canon)) contains.push(canon);
  }
  return [...starts, ...contains].slice(0, limit);
}

// ---- Small helpers touching Template/manifest data ----
export function firstNameFromFull(name: string): string {
  return name.split(" ")[0];
}
