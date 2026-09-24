/**
 * Every date/time read in the app goes through here. No bare Date.now()
 * or new Date() anywhere else, so tests and the debug panel's clock-skip
 * actions can control time deterministically.
 */

export type Clock = () => number;

declare global {
  interface Window {
    __allyClock?: Clock;
  }
}

/** Current time in ms since epoch. Honours a test-only override on window.__allyClock. */
export function now(): number {
  if (typeof window !== "undefined" && typeof window.__allyClock === "function") {
    return window.__allyClock();
  }
  return Date.now();
}

// P2 (spec D8): the ledger's day rollover and pass expiry run on the
// database's clock. Ledger reads in the UI use serverNow(), which ignores
// window.__allyClock and only corrects for device clock drift, so the chips
// and composer agree with what send_message will actually allow.
let serverOffsetMs = 0;

/** Records the server's current time (epoch ms) from an RPC response. */
export function setServerTime(serverMs: number): void {
  serverOffsetMs = serverMs - Date.now();
}

/** Best estimate of the database's now(), in ms. Never debug-skewed. */
export function serverNow(): number {
  return Date.now() + serverOffsetMs;
}

const KOLKATA_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** YYYY-MM-DD for the given instant, in Asia/Kolkata, independent of device timezone. */
export function dayKey(ms: number): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date(ms));
}

/** hh:mm am/pm for the given instant, in Asia/Kolkata. */
export function formatTimeIST(ms: number): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return fmt.format(new Date(ms)).replace(/\s?([ap])m$/i, (_m, p) => ` ${p.toLowerCase()}m`);
}

/** Day (07:00-19:59) vs night presence variant, in Asia/Kolkata. */
export function isDaytimeIST(ms: number): boolean {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    hour12: false,
  });
  const hour = Number(fmt.format(new Date(ms)));
  return hour >= 7 && hour < 20;
}

/** `{d MMMM}` (+ ` {yyyy}` if not the current year), in Asia/Kolkata. */
export function formatTogetherSince(ms: number, nowMs: number): string {
  const d = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric" }).format(new Date(ms));
  const month = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", month: "long" }).format(new Date(ms));
  const year = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric" }).format(new Date(ms));
  const nowYear = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric" }).format(new Date(nowMs));
  return year === nowYear ? `${d} ${month}` : `${d} ${month} ${year}`;
}

export const _KOLKATA_OFFSET_MS = KOLKATA_OFFSET_MS;
