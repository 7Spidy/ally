/**
 * B2 trust engine (spec 4.6). Pure: no clock reads, no I/O. Callers pass
 * `now` and the user message's own timestamp, so a message sent just before
 * midnight IST is credited to the day it was sent on (edge case 8).
 * The SQL twin of decay() is ally_private.trust_decay().
 */

import { dayKey } from "@/lib/clock";

export const LEVELS: { level: number; tp: number; minDay: number; signal?: boolean }[] = [
  { level: 2, tp: 40, minDay: 3 },
  { level: 3, tp: 150, minDay: 10 },
  { level: 4, tp: 330, minDay: 22, signal: true },
  { level: 5, tp: 560, minDay: 38 },
  { level: 6, tp: 840, minDay: 60, signal: true },
];
export const DAILY_CAP = 15;

export const MSG_POINTS_CAP = 10;
export const MSG_MIN_WORDS = 6;
export const SESSION_BONUS_MSGS = 8;
export const SESSION_BONUS = 3;
export const DISCLOSURE_BONUS = 2;
export const COOL_OFF_MS = 48 * 3600 * 1000;
export const DROP_GAP_DAYS = 7;
export const DECAY_IDLE_DAYS = 5;
export const DECAY_POINTS = 5;
export const DEMOTE_AFTER_DAYS = 7;

const DAY_MS = 86400000;

export interface TrustState {
  level: number;
  highestLevel: number;
  points: number;
  levelChangedAt: number | null;
  lastDropAt: number | null;
  /** IST day key on which TP was first seen below the current level's threshold. */
  belowSince: string | null;
  signalSinceLevel: boolean;
  coolOffUntil: number | null;
  trustFrozenUntil: number | null;
}

export interface TrustDay {
  msgPoints: number;
  sessionBonus: boolean;
  disclosureBonus: boolean;
  userMsgs: number;
}

export interface ReplyInput {
  /** created_at of the user message this reply answers (ms). */
  messageAt: number;
  /** Word count of that message. */
  words: number;
  /** User messages this reply covers (1 unless the user sent several while a reply was in flight). */
  userMsgs?: number;
  disclosure: boolean;
  mutualVulnerability: boolean;
  abusive: boolean;
  /** IST days since the companion was created, day 0 = lock day. */
  relationshipDay: number;
}

export interface TrustResult {
  state: TrustState;
  day: TrustDay;
  /** The level just reached, or null. 6 allows `petals` on this reply. */
  leveledUp: number | null;
  dropped: boolean;
  frozen: boolean;
}

export function freshTrust(): TrustState {
  return {
    level: 1,
    highestLevel: 1,
    points: 0,
    levelChangedAt: null,
    lastDropAt: null,
    belowSince: null,
    signalSinceLevel: false,
    coolOffUntil: null,
    trustFrozenUntil: null,
  };
}

export function freshDay(): TrustDay {
  return { msgPoints: 0, sessionBonus: false, disclosureBonus: false, userMsgs: 0 };
}

function keyToUtc(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole IST calendar days from key `a` to key `b` (b later gives a positive number). */
export function istDaysBetween(a: string, b: string): number {
  return Math.round((keyToUtc(b) - keyToUtc(a)) / DAY_MS);
}

/** IST days since the companion was created, day 0 = lock day. */
export function relationshipDay(createdAt: number, at: number): number {
  return Math.max(0, istDaysBetween(dayKey(createdAt), dayKey(at)));
}

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** TP the current level must hold to avoid demotion pressure (level 1 has none). */
export function thresholdFor(level: number): number {
  return LEVELS.find((l) => l.level === level)?.tp ?? 0;
}

function dayTotal(d: TrustDay): number {
  return d.msgPoints + (d.sessionBonus ? SESSION_BONUS : 0) + (d.disclosureBonus ? DISCLOSURE_BONUS : 0);
}

/** One reply's worth of trust changes. Never mutates its inputs. */
export function applyReply(state: TrustState, day: TrustDay, input: ReplyInput, now: number): TrustResult {
  if (state.trustFrozenUntil !== null && state.trustFrozenUntil > now) {
    return { state, day, leveledUp: null, dropped: false, frozen: true };
  }

  const s: TrustState = { ...state };
  const d: TrustDay = { ...day };
  d.userMsgs += input.userMsgs ?? 1;

  if (input.abusive) {
    // One drop per 7 days, but the cool-off always applies. No points, no promotion.
    s.coolOffUntil = now + COOL_OFF_MS;
    let dropped = false;
    if (s.level > 1 && (s.lastDropAt === null || now - s.lastDropAt >= DROP_GAP_DAYS * DAY_MS)) {
      s.level -= 1;
      s.lastDropAt = now;
      s.levelChangedAt = now;
      s.belowSince = null;
      dropped = true;
    }
    return { state: s, day: d, leveledUp: null, dropped, frozen: false };
  }

  let room = DAILY_CAP - dayTotal(d);
  let gained = 0;
  if (input.words >= MSG_MIN_WORDS && d.msgPoints < MSG_POINTS_CAP && room > 0) {
    d.msgPoints += 1;
    room -= 1;
    gained += 1;
  }
  if (!d.sessionBonus && d.userMsgs >= SESSION_BONUS_MSGS && room >= SESSION_BONUS) {
    d.sessionBonus = true;
    room -= SESSION_BONUS;
    gained += SESSION_BONUS;
  }
  if (input.disclosure && !d.disclosureBonus && room >= DISCLOSURE_BONUS) {
    d.disclosureBonus = true;
    room -= DISCLOSURE_BONUS;
    gained += DISCLOSURE_BONUS;
  }
  s.points += gained;

  if (input.mutualVulnerability) s.signalSinceLevel = true;

  let leveledUp: number | null = null;
  const next = LEVELS.find((l) => l.level === s.level + 1);
  if (next && s.points >= next.tp && input.relationshipDay >= next.minDay && (!next.signal || s.signalSinceLevel)) {
    s.level = next.level;
    s.highestLevel = Math.max(s.highestLevel, next.level);
    s.levelChangedAt = now;
    s.signalSinceLevel = false;
    s.belowSince = null;
    leveledUp = next.level;
  }

  return { state: s, day: d, leveledUp, dropped: false, frozen: false };
}

/**
 * The daily decay pass for one companion. `lastUserMsgAt` is the newest user
 * message (or the companion's creation when there is none).
 */
export function decay(state: TrustState, lastUserMsgAt: number, now: number): TrustState {
  const s: TrustState = { ...state };
  const today = dayKey(now);

  if (istDaysBetween(dayKey(lastUserMsgAt), today) >= DECAY_IDLE_DAYS) {
    s.points = Math.max(0, s.points - DECAY_POINTS);
  }

  const below = s.points < thresholdFor(s.level);
  if (below && s.belowSince === null) s.belowSince = today;
  if (!below) s.belowSince = null;

  if (
    s.belowSince !== null &&
    s.level > 1 &&
    istDaysBetween(s.belowSince, today) >= DEMOTE_AFTER_DAYS &&
    (s.lastDropAt === null || now - s.lastDropAt >= DROP_GAP_DAYS * DAY_MS)
  ) {
    s.level -= 1;
    s.lastDropAt = now;
    s.levelChangedAt = now;
    s.belowSince = null;
  }
  return s;
}
