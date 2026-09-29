/**
 * Small wrappers for the onboarding pages: the proposal (`choosing/page.tsx`
 * runs it after the deck, and again after the proposal screen's "Show me
 * someone else" dispatches `REDRAW`), the core's deck, and the faces on the
 * Constellation's ring.
 */
import { buildCoreDeck, computeCore, nextProposal, rankByDwell, type DeckProposalState, type NextProposal, type Template } from "@/lib/engine";
import type { OnboardingFlow } from "@/state/schema";

/** FNV-1a over a string, then mulberry32: a small deterministic PRNG. */
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded from what defines a proposal (who was liked, who was already
 * redrawn away, how many redraws), never from `proposalsSeen`, which every
 * PROPOSE bumps: a refresh mid-Constellation must replay the same winner.
 */
function proposalRand(liked: string[], poolRemoved: string[], redraws: number): () => number {
  return seededRandom(`${liked.join(",")}|${poolRemoved.join(",")}|${redraws}`);
}

export function proposeFor(flow: OnboardingFlow): NextProposal {
  const st: DeckProposalState = {
    liked: flow.liked,
    deckOrder: flow.deckOrder,
    dwell: flow.dwell,
    poolRemoved: flow.poolRemoved,
    redraws: flow.redraws,
  };
  return nextProposal(st, proposalRand(flow.liked, flow.poolRemoved, flow.redraws));
}

/**
 * The deck for this flow's answers: the user's core deck, falling back to
 * the second then third ranked core if it is empty (D4), ordered by
 * `orderDeck`. Computes the core from the answers rather than reading
 * `flow.core`, which may not have been written yet.
 */
export function deckFor(flow: OnboardingFlow, templates: Template[], excluded: ReadonlySet<string>, rand?: () => number): string[] {
  if (!flow.deckGender) return [];
  const { ranked } = computeCore(flow.answers);
  const user = { region: flow.region, age: flow.age, interests: flow.answers.q11 };
  return buildCoreDeck(templates, flow.deckGender, excluded, ranked, user, rand).map((t) => t.id);
}

export const CONSTELLATION_MAX_LIKED = 9;
export const CONSTELLATION_NOLIKES = 5;

/**
 * The faces on the Constellation's ring. The liked faces (best dwell first,
 * at most nine); with no likes, the top five by dwell. One liked face means
 * no ring. The winner is always on it.
 */
export function constellationFaces(flow: OnboardingFlow, winner: string): string[] {
  let ids: string[];
  if (flow.liked.length === 0) ids = rankByDwell(flow.deckOrder, flow.dwell).slice(0, CONSTELLATION_NOLIKES);
  else if (flow.liked.length === 1) ids = [flow.liked[0]];
  else ids = rankByDwell(flow.liked, flow.dwell).slice(0, CONSTELLATION_MAX_LIKED);
  if (ids.includes(winner)) return ids;
  return ids.length ? [...ids.slice(0, -1), winner] : [winner];
}
