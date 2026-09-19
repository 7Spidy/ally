/**
 * Small wrappers around `nextProposal`/`REDRAW` so `choosing/page.tsx` and
 * the proposal screen's "Show me someone else" button compute the exact
 * same result the reducer would, without relying on a second render to
 * see a post-dispatch flow (dispatches are fire-and-forget; the caller
 * needs the computed `NextProposal` synchronously to dispatch `PROPOSE`
 * in the same batch as `REDRAW`).
 */
import { nextProposal, type DeckProposalState, type NextProposal } from "@/lib/engine";
import type { OnboardingFlow } from "@/state/schema";

export function proposeFor(flow: OnboardingFlow): NextProposal {
  const st: DeckProposalState = {
    liked: flow.liked,
    deckOrder: flow.deckOrder,
    dwell: flow.dwell,
    poolRemoved: flow.poolRemoved,
    redraws: flow.redraws,
  };
  return nextProposal(st);
}

/** What `REDRAW` will do to `poolRemoved`/`redraws`, computed ahead of dispatch. */
export function redrawFor(flow: OnboardingFlow): NextProposal {
  const poolRemoved = flow.proposed && !flow.poolRemoved.includes(flow.proposed) ? [...flow.poolRemoved, flow.proposed] : flow.poolRemoved;
  const redraws = flow.redraws + 1;
  const st: DeckProposalState = { liked: flow.liked, deckOrder: flow.deckOrder, dwell: flow.dwell, poolRemoved, redraws };
  return nextProposal(st);
}
