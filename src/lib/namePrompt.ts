import type { AllyState } from "@/state/schema";

const EXCLUDED = ["/onboarding", "/login", "/auth", "/blocked", "/admin"];

/** Whether the "What should I call you?" sheet is due: a signed-in user past onboarding with no name. */
export function shouldPromptName(args: { ready: boolean; hasSession: boolean; state: AllyState; pathname: string }): boolean {
  const { ready, hasSession, state, pathname } = args;
  if (!ready || !hasSession) return false;
  if (state.user.displayName.trim() !== "") return false;
  if (!(state.companions.length > 0 || state.user.accountAt !== null)) return false;
  return !EXCLUDED.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
