/**
 * The pure decision behind spec §4.2's boot table: given state (already
 * migrated) and the current time, which phase/route should `app/page.tsx`
 * land on. Kept separate from the component so it's unit-testable without
 * React/DOM.
 */

import type { AllyState } from "@/state/schema";
import { active, lastOpened } from "@/lib/selectors";

const DAY_MS = 86400000;

export type BootTarget =
  | { phase: "blocked" }
  | { phase: "first-splash"; step: string }
  /** 7-30 days since state.savedAt: offer continue-or-start-over instead of resuming silently (PRD §4.1 / spec §4.2). */
  | { phase: "first-choose"; step: string }
  | { phase: "returning-splash"; target: string };

export function bootTarget(state: AllyState, blocked: boolean, now: number): BootTarget {
  if (blocked) return { phase: "blocked" };

  // A stale round-two flow never survives to this decision; the caller
  // dispatches LEAVE_ROUND2 before calling this, but guard here too so the
  // pure function is correct standalone.
  const flow = state.flow && state.flow.kind === "round2" ? null : state.flow;

  const hasCompanionEver = state.companions.length > 0 || state.user.accountAt !== null;

  if (!hasCompanionEver && (!flow || flow.kind === "first")) {
    const step = flow?.step ?? "consent";
    const ageDays = (now - state.savedAt) / DAY_MS;
    // Beyond 30 days: discard silently, land at consent as if fresh.
    if (ageDays > 30) return { phase: "first-splash", step: "consent" };
    // 7-30 days: offer continue or start over, never resume silently.
    if (ageDays >= 7) return { phase: "first-choose", step };
    // Within 7 days: the user just lands where they left off.
    return { phase: "first-splash", step };
  }

  const activeList = active(state);
  if (activeList.length > 0) {
    const target = lastOpened(state);
    return { phase: "returning-splash", target: target ? `/chat/${target.id}` : "/home" };
  }

  return { phase: "returning-splash", target: "/home" };
}
