/**
 * Message-allowance ledger. Pure functions, `(ledger, now) => ...`. No DOM,
 * no storage, no Date() — the caller supplies `now` in ms and, for unlocks,
 * the amount.
 */

import type { Ledger } from "@/state/schema";
import { dayKey } from "@/lib/clock";
import { FREE_DAILY, PASS_HOURS, PASS_CAP, MAX_COMPANIONS, PRICE_DAY_PASS } from "@/lib/config";

/** Zeroes freeUsed when the Asia/Kolkata day has rolled over since `l.day`. */
export function rollDay(l: Ledger, now: number): Ledger {
  const day = dayKey(now);
  if (day !== l.day) return { ...l, day, freeUsed: 0 };
  return l;
}

export function passActive(l: Ledger, now: number): boolean {
  return l.pass !== null && now < l.pass.endsAt;
}

export function freeLeft(l: Ledger, now: number): number {
  return (l.freeDaily ?? FREE_DAILY) - rollDay(l, now).freeUsed;
}

export type SendStatus = "ok" | "capped" | "empty";

export function canSend(l: Ledger, now: number): SendStatus {
  if (passActive(l, now)) {
    return (l.pass as NonNullable<Ledger["pass"]>).used < (l.passCap ?? PASS_CAP) ? "ok" : "capped";
  }
  return freeLeft(l, now) > 0 ? "ok" : "empty";
}

/** Only spends when canSend === 'ok'; otherwise returns `l` unchanged. */
export function spend(l: Ledger, now: number): Ledger {
  if (canSend(l, now) !== "ok") return l;
  const rolled = rollDay(l, now);
  if (passActive(rolled, now)) {
    return { ...rolled, pass: { ...(rolled.pass as NonNullable<Ledger["pass"]>), used: (rolled.pass as NonNullable<Ledger["pass"]>).used + 1 } };
  }
  return { ...rolled, freeUsed: rolled.freeUsed + 1 };
}

/** No-op while a pass is already active. */
export function buyPass(l: Ledger, now: number): Ledger {
  if (passActive(l, now)) return l;
  const pass = { startedAt: now, endsAt: now + PASS_HOURS * 3600000, used: 0 };
  return { ...l, pass, passes: [...l.passes, { startedAt: now, amount: PRICE_DAY_PASS }] };
}

export function unlock(l: Ledger, amount: number, now: number): Ledger {
  const slotsUnlocked = Math.min(MAX_COMPANIONS, l.slotsUnlocked + 1);
  return {
    ...l,
    slotsUnlocked,
    unlocks: [...l.unlocks, { slot: slotsUnlocked, at: now, amount }],
  };
}
