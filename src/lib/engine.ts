/**
 * Matching, deck ordering, dwell, propose, age gate, location resolution.
 * Ported verbatim from `#ally-engine` in ally-onboarding.html. No DOM, no
 * storage, no Date() — every external input is a parameter. Formulas are
 * unchanged; only types and the `excluded` deck parameter (spec §7.1/§8.4)
 * are new.
 */

import type { CoreId, Pressure, Gender, Answers } from "@/state/schema";

// ---- Cores. Hardcoded by contract. Never shown to the user. ----
export interface CoreDef {
  id: CoreId;
  arc: "romantic" | "mentor" | "friend";
  warmth: number;
  push: number;
  structure: number;
  disclosure: number;
  nostalgia: number;
  owns: Pressure;
}

export const CORES: CoreDef[] = [
  { id: "KIAAN", arc: "romantic", warmth: 0.95, push: 0.25, structure: 0.3, disclosure: 0.55, nostalgia: 0.45, owns: "alone" },
  { id: "MEHER", arc: "mentor", warmth: 0.7, push: 0.3, structure: 0.55, disclosure: 0.9, nostalgia: 0.35, owns: "head" },
  { id: "ANANYA", arc: "mentor", warmth: 0.35, push: 0.55, structure: 0.9, disclosure: 0.4, nostalgia: 0.2, owns: "money" },
  { id: "VEER", arc: "mentor", warmth: 0.2, push: 0.95, structure: 0.85, disclosure: 0.3, nostalgia: 0.1, owns: "health" },
  { id: "PRIYA", arc: "friend", warmth: 0.9, push: 0.4, structure: 0.2, disclosure: 0.7, nostalgia: 0.25, owns: "notgood" },
  { id: "ANAY", arc: "friend", warmth: 0.75, push: 0.2, structure: 0.25, disclosure: 0.5, nostalgia: 0.95, owns: "change" },
];

export const WEIGHTS = { warmth: 1.3, push: 1.25, structure: 1.0, disclosure: 0.85, nostalgia: 0.7 } as const;
export const AXES = Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[];
export const PRESSURES: Pressure[] = ["money", "health", "head", "alone", "notgood", "change"];
export const DISCLOSURE_STOPS = [0.1, 0.4, 0.7, 0.95] as const;
export const STRUCTURE_STOPS = [0.1, 0.38, 0.68, 0.95] as const;
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

// ---- Matching ----
export interface UserVector {
  warmth: number;
  push: number;
  structure: number;
  disclosure: number;
  nostalgia: number;
}

export function userVector(a: Answers): UserVector {
  return { warmth: a.q6 ?? 0, push: a.q7 ?? 0, structure: a.q8 ?? 0, disclosure: a.q5 ?? 0, nostalgia: a.q9 ?? 0 };
}

export interface RankedCore {
  id: CoreId;
  score: number;
}

export function scoreCores(a: Answers): RankedCore[] {
  const u = userVector(a);
  const maxD = Math.sqrt(AXES.reduce((s, k) => s + WEIGHTS[k], 0));
  return CORES.map((c) => {
    const d = Math.sqrt(AXES.reduce((s, k) => s + WEIGHTS[k] * (u[k] - c[k]) ** 2, 0));
    let score = 1 - d / maxD;
    if (c.owns === a.q10) score *= 1.15;
    return { id: c.id, score: +score.toFixed(4) };
  }).sort((x, y) => y.score - x.score);
}

export interface AssignedCore {
  primary: CoreId;
  secondary: CoreId | null;
  weight: 100 | 70;
}

export function assignCore(ranked: RankedCore[]): AssignedCore {
  const [first, second, third] = ranked;
  if (first.score - second.score >= 0.06) {
    return { primary: first.id, secondary: null, weight: 100 };
  }
  const support = second.id === "KIAAN" ? third : second; // Romantic never supports
  return { primary: first.id, secondary: support.id, weight: 70 };
}

export interface ComputedCore extends AssignedCore {
  ranked: RankedCore[];
}

export function computeCore(answers: Answers): ComputedCore {
  const ranked = scoreCores(answers);
  return { ...assignCore(ranked), ranked };
}

// ---- Deck ----

/** Gender is the base filter; `excluded` removes active/parted faces (spec §7.1, §8.3). */
export function deckTemplates(templates: Template[], gender: Gender, excluded?: ReadonlySet<string>): Template[] {
  return templates.filter((t) => t.gender === gender && !(excluded && excluded.has(t.id)));
}

/** Alias matching §8.3's `pool(templates, gender, excluded)` signature. */
export const pool = deckTemplates;

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
