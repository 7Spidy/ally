/**
 * The pure decision behind spec §4.2's boot table: given state (already
 * migrated) and the current time, which phase/route should `app/page.tsx`
 * land on. Kept separate from the component so it's unit-testable without
 * React/DOM.
 */

import type { AllyState } from "@/state/schema";
import { active, lastOpened } from "@/lib/selectors";

export type BootTarget =
  | { phase: "blocked" }
  | { phase: "first-splash"; step: string }
  | { phase: "returning-splash"; target: string };

export function bootTarget(state: AllyState, blocked: boolean): BootTarget {
  if (blocked) return { phase: "blocked" };

  // A stale round-two flow never survives to this decision; the caller
  // dispatches LEAVE_ROUND2 before calling this, but guard here too so the
  // pure function is correct standalone.
  const flow = state.flow && state.flow.kind === "round2" ? null : state.flow;

  const hasCompanionEver = state.companions.length > 0 || state.user.accountAt !== null;

  if (!hasCompanionEver && (!flow || flow.kind === "first")) {
    return { phase: "first-splash", step: flow?.step ?? "consent" };
  }

  const activeList = active(state);
  if (activeList.length > 0) {
    const target = lastOpened(state);
    return { phase: "returning-splash", target: target ? `/chat/${target.id}` : "/home" };
  }

  return { phase: "returning-splash", target: "/home" };
}
