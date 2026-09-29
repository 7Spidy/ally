/**
 * Answer-invalidation table, spec §9.3 / PRD §10.1 (B1: q5..q10 also clear the tiebreak and the core deck), ported from `invalidate()`
 * in `#ally-engine` (ally-onboarding.html). Not part of `src/lib` because
 * it operates on `OnboardingFlow` shape decisions specific to how these
 * pages call it (which key changed) rather than being a standalone pure
 * formula; kept here, beside the pages that use it, per the onboarding
 * work area's scope.
 */
import { emptyCore, type OnboardingFlow } from "@/state/schema";

export type InvalidationKey = "location" | "gender" | "name" | "birthday" | "q5" | "q6" | "q7" | "q8" | "q9" | "q10" | "q11" | "tb";

const FRESH_DECK = { deckOrder: [] as string[], deckIndex: 0, deckHistory: [] as string[] };
const FRESH_DECK_STATE = {
  ...FRESH_DECK,
  dwell: {} as Record<string, number>,
  liked: [] as string[],
  expanded: [] as string[],
  proposed: null as string | null,
  proposalsSeen: 0,
  poolRemoved: [] as string[],
  redraws: 0,
  canRedraw: false,
  proposalMode: null as string | null,
};

export function invalidationFor(key: InvalidationKey, flow: OnboardingFlow): { patch: Partial<OnboardingFlow> | null; changed: boolean } {
  const hadDeck = flow.deckOrder.length > 0;
  const hadDeckState = hadDeck || flow.liked.length > 0 || Object.keys(flow.dwell).length > 0 || flow.proposed !== null;
  const hadCore = flow.core.primary !== null;

  switch (key) {
    case "location":
    case "birthday":
    case "q11":
      return { patch: FRESH_DECK, changed: hadDeck };
    case "gender":
      return { patch: FRESH_DECK_STATE, changed: hadDeckState };
    case "name":
      return { patch: null, changed: false };
    case "q5":
    case "q6":
    case "q7":
    case "q8":
    case "q9":
    case "q10":
      // The core picks the deck, and a new answer can move the core, so the
      // deck starts again too. The tiebreak was decided against the old answers.
      return {
        patch: { core: emptyCore(), answers: { ...flow.answers, tb: null }, ...FRESH_DECK_STATE },
        changed: hadCore || hadDeckState || flow.answers.tb !== null,
      };
    case "tb":
      return { patch: { core: emptyCore(), ...FRESH_DECK_STATE }, changed: hadCore || hadDeckState };
    default:
      return { patch: null, changed: false };
  }
}
