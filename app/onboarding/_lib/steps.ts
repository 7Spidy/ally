/**
 * Shared route/step bookkeeping for the onboarding area. `ORDER` is the
 * first-run screen sequence (PRD flow order); back targets for a first-run
 * screen are simply "the previous entry in this list" per spec §9.1.
 * Round-two screens never use this table for back — they always show an X
 * that opens the leave sheet instead (handled in layout.tsx).
 */

export const ORDER = [
  "consent",
  "location",
  "gender",
  "name",
  "birthday",
  "questions/disclosure",
  "questions/warmth",
  "questions/push",
  "questions/structure",
  "questions/nostalgia",
  "questions/pressure",
  "questions/interests",
  "matching",
  "deck",
  "choosing",
  "proposal",
  "reveal",
] as const;

export type Step = (typeof ORDER)[number];

export const STEP_TO_PATH: Record<Step, string> = {
  consent: "/onboarding/consent",
  location: "/onboarding/location",
  gender: "/onboarding/gender",
  name: "/onboarding/name",
  birthday: "/onboarding/birthday",
  "questions/disclosure": "/onboarding/questions/disclosure",
  "questions/warmth": "/onboarding/questions/warmth",
  "questions/push": "/onboarding/questions/push",
  "questions/structure": "/onboarding/questions/structure",
  "questions/nostalgia": "/onboarding/questions/nostalgia",
  "questions/pressure": "/onboarding/questions/pressure",
  "questions/interests": "/onboarding/questions/interests",
  matching: "/onboarding/matching",
  deck: "/onboarding/deck",
  choosing: "/onboarding/choosing",
  proposal: "/onboarding/proposal",
  reveal: "/onboarding/reveal",
};

/** The seven question steps, in order — used for the Q5-Q11 progress rule. */
export const QUESTION_STEPS: Step[] = [
  "questions/disclosure",
  "questions/warmth",
  "questions/push",
  "questions/structure",
  "questions/nostalgia",
  "questions/pressure",
  "questions/interests",
];

/** Screens that never show a back/X control (first entry, or tap-to-continue screens). */
export const NO_BACK_STEPS: Set<Step> = new Set(["consent", "reveal", "choosing"]);

export function stepFromPathname(pathname: string): Step | null {
  const seg = pathname.replace(/^\/onboarding\//, "");
  return (ORDER as readonly string[]).includes(seg) ? (seg as Step) : null;
}

export function backTargetFor(step: Step): string | null {
  const idx = ORDER.indexOf(step);
  if (idx <= 0) return null;
  return STEP_TO_PATH[ORDER[idx - 1]];
}
