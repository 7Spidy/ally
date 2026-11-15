/**
 * Date separators and the tap-for-time label in a chat. Pure: `now` is passed
 * in, and "a day" is the viewer's local calendar day.
 */

import { COPY } from "@/lib/copy";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The local calendar day of an instant, as a comparable number (year * 10000 + month * 100 + day). */
export function localDayNumber(ms: number): number {
  const d = new Date(ms);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** True when the two instants fall on different local days. */
export function differentDay(aMs: number, bMs: number): boolean {
  return localDayNumber(aMs) !== localDayNumber(bMs);
}

/** Whole local calendar days from `fromMs`'s day to `toMs`'s day. */
function dayGap(fromMs: number, toMs: number): number {
  const a = new Date(fromMs);
  const b = new Date(toMs);
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / 86400000);
}

/** "Today", "Yesterday", else "Mon 9 Nov", with the year ("Mon 9 Nov 2025") when it is not the current year. */
export function dayLabel(ms: number, nowMs: number): string {
  const gap = dayGap(ms, nowMs);
  if (gap === 0) return COPY.chat.today;
  if (gap === 1) return COPY.chat.yesterday;
  const d = new Date(ms);
  const base = `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(nowMs).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** The time shown under a tapped bubble, e.g. "9:41 pm". */
export function timeLabel(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}
