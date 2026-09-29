# claude_change_spec.md: B1, five cores and onboarding motion

Repo baseline: latest `main` (first-run visuals, P1, P2 and P3 merged). Work on a new branch `b1-five-cores`. Do not merge to `main`.

Archive first: move the current contents of this file (first-run visuals spec) to `docs/specs/first-run-visuals.md`, then replace it with this spec.

B2 (live chat with Ira) follows on a separate branch cut from this one. Nothing in B1 calls an LLM.

---

## 1. Context and goal

The product moved from six hidden cores to five, with faces bound to cores (casting sheet v7). The code still runs the six-core distance engine and shows every face of a gender in every deck. B1 does four things:

1. Replace the engine with five cores, direct scoring, and a tiebreaker screen, so the questions settle on one core confidently.
2. Bind each deck to the user's core using the v7 casting map.
3. Replace the vertical sliders with tappable option cards, and strip the gender labels from the Rivers screen.
4. Add two motion pieces: a first-deck tutorial and the "Constellation" selection moment between deck and proposal.

## 2. Locked decisions

| # | Decision |
|---|---|
| D1 | Five cores, new ids: `ROMANTIC` (Slow-Burn Romantic), `PSYCH` (Calm Psychologist), `MONEY` (Money Mentor), `TRAINER` (Tough-Love Trainer), `FRIEND` (Best Friend). Old ids migrate: KIAAN→ROMANTIC, MEHER→PSYCH, ANANYA→MONEY, VEER→TRAINER, PRIYA→FRIEND, ANAY→FRIEND. Core ids stay hidden from users. |
| D2 | Scoring is direct points per answer (section 4.2), not distance. Ties that include ROMANTIC resolve to ROMANTIC. Close calls go to a tiebreaker screen. |
| D3 | A face is eligible for a core's deck if its v7 primary or secondary core equals that core. **F01 is excluded from every deck except ROMANTIC** (its Money brain does not exist yet). |
| D4 | If a user's core deck is empty after exclusions (active and parted faces), fall back to the second-ranked core's deck, then the third. The user is never told. |
| D5 | Q5 to Q9 become 4 tappable cards each. Selecting a card auto-advances after 350 ms. Q10 keeps its dial. Q11 keeps its tiles. |
| D6 | Answers for q5 to q9 are stored as the option index 0 to 3, not a float. |
| D7 | Q9 (nostalgia) is replaced. Its core no longer exists. New route `questions/offday`. |
| D8 | Rivers: remove the "Woman"/"Man" label text only. Keep the button `aria-label`s ("A woman", "A man") and keep the round-two "No new faces left here" sub-label. |
| D9 | Deck tutorial plays on the first deck of the first run only, on the real first card, inputs locked, Skip after 1500 ms, replayable from a "?" button on every deck. |
| D10 | Constellation replaces the invisible `choosing` waypoint. Sound is synthesised with Web Audio (no audio files) and respects `user.soundOn`. |
| D11 | Zero likes: the Constellation uses the top 5 faces by dwell, and the proposal is the highest-dwell face (current `nextProposal` "nolikes" behaviour already ranks by dwell; keep it). |
| D12 | Reduced motion: `window.matchMedia("(prefers-reduced-motion: reduce)")` read on mount, as elsewhere. |
| D13 | No new runtime dependencies. |

## 3. Scope

### Create

| Path | Purpose |
|---|---|
| `src/lib/coreMap.ts` | v7 face-to-core map (section 4.3) |
| `app/onboarding/_components/QuestionCards.tsx` + `.module.css` | Tappable 4-card question (section 4.4) |
| `app/onboarding/questions/offday/page.tsx` | New Q9 |
| `app/onboarding/questions/tiebreak/page.tsx` + `.module.css` | Conditional tiebreaker (section 4.5) |
| `app/onboarding/deck/DeckTutorial.tsx` + `.module.css` | Tutorial overlay and choreography (section 4.6) |
| `app/onboarding/choosing/Constellation.tsx` + `.module.css` | Selection moment (section 4.7) |
| `src/lib/sound/heartbeat.ts` | Web Audio synth for the Constellation |
| `supabase/migrations/20260930000001_five_cores.sql` | Rewrite stored core ids (section 4.9) |
| `tests/unit/fiveCores.test.ts`, `tests/e2e/e27-b1-onboarding.spec.ts` | Tests (section 6) |

### Modify

| Path | Change |
|---|---|
| `src/state/schema.ts` | `CoreId`, `Answers` (add `tb`), `OnboardingFlow` (add `tutorialShown`), state version bump |
| `src/lib/engine.ts` | Remove `CORES`/`WEIGHTS`/`AXES`/distance scoring/`userVector`/stops; add section 4.2; deck filter by core |
| `src/lib/copy.ts` | New question copy, tiebreak copy, tutorial copy; re-key `OPENERS` and `REPLIES` to new ids (drop ANAY) |
| `src/lib/migrate.ts` | Migration for the state bump (section 4.9) |
| `app/onboarding/_lib/steps.ts`, `invalidate.ts`, `propose.ts` | New steps, invalidation, deck build |
| `app/onboarding/questions/{disclosure,warmth,push,structure}/page.tsx` | Use `QuestionCards` |
| `app/onboarding/questions/interests/page.tsx` | Route to tiebreak or matching |
| `app/onboarding/deck/page.tsx` | Mount tutorial, "?" button, pause dwell during tutorial |
| `app/onboarding/choosing/page.tsx` | Render Constellation, then route |
| `app/onboarding/proposal/page.tsx` | Redraw routes through the short Constellation |
| `src/components/firstRun/ChoiceRivers.tsx` | Remove label text (D8) |
| `src/state/allyReducer.ts` | New actions `SET_TUTORIAL_SHOWN`; `COMPUTE_CORE` uses new engine; `DECK_INIT` uses core decks |
| `tests/unit/engine.test.ts`, `copy.test.ts`, `migrate.test.ts`, `allyReducer.test.ts`, `tests/rls/*`, `tests/e2e/helpers.ts`, `tests/e2e/e1-first-run.spec.ts` | Update for new ids and card questions |

### Delete

`app/onboarding/_components/QuestionSlider.tsx` and `.module.css`, `app/onboarding/questions/nostalgia/`.

## 4. Implementation

### 4.1 Schema

```ts
export type CoreId = "ROMANTIC" | "PSYCH" | "MONEY" | "TRAINER" | "FRIEND";
export interface Answers {
  q5: number | null; q6: number | null; q7: number | null; q8: number | null; q9: number | null; // option index 0..3
  q10: Pressure | null;
  q11: string[];
  tb: CoreId | null; // tiebreak winner, null if no tiebreak was needed
}
```
`OnboardingFlow` gains `tutorialShown: boolean` (default false). Bump `AllyState.v` from 2 to 3. `Pressure` is unchanged.

### 4.2 Scoring (`src/lib/engine.ts`)

Every answer adds points. `CORE_ORDER = ["ROMANTIC","PSYCH","FRIEND","MONEY","TRAINER"]` is the stable sort order for equal scores, which makes ROMANTIC win exact ties it is part of.

```ts
export const SCORE: Record<"q5"|"q6"|"q7"|"q8"|"q9", Partial<Record<CoreId, number>>[]> = {
  q5: [ {ROMANTIC:2, PSYCH:1}, {ROMANTIC:2, PSYCH:1}, {PSYCH:2, FRIEND:1}, {FRIEND:2, TRAINER:1} ],
  q6: [ {ROMANTIC:2, PSYCH:1}, {FRIEND:2, ROMANTIC:1}, {PSYCH:2, MONEY:1}, {MONEY:2, TRAINER:1} ],
  q7: [ {PSYCH:2, ROMANTIC:1}, {ROMANTIC:2}, {FRIEND:2}, {TRAINER:2, MONEY:1} ],
  q8: [ {FRIEND:2, ROMANTIC:1}, {ROMANTIC:2, PSYCH:1}, {MONEY:2, PSYCH:1}, {TRAINER:2, MONEY:1} ],
  q9: [ {PSYCH:2}, {FRIEND:2}, {ROMANTIC:2}, {TRAINER:2, MONEY:1} ],
};
export const PRESSURE_OWNER: Record<Pressure, CoreId> = {
  money: "MONEY", health: "TRAINER", head: "PSYCH", alone: "ROMANTIC", notgood: "FRIEND", change: "FRIEND",
};
export const PRESSURE_POINTS = 3;
export const TIEBREAK_POINTS = 3;
export const CLOSE_MARGIN = 2; // top minus second below this is a close call
```

- `scoreCores(a)` returns all five `{ id, score }` sorted by score desc, then `CORE_ORDER`. Add `TIEBREAK_POINTS` to `a.tb` when set.
- `needsTiebreak(ranked, a)`: false if `a.tb` is set. False if the top two are exactly equal and one is ROMANTIC (ROMANTIC already ranks first). Otherwise true when `ranked[0].score - ranked[1].score < CLOSE_MARGIN`. Returns the pair `[ranked[0].id, ranked[1].id]` when true.
- `assignCore(ranked)`: primary is `ranked[0]`. Secondary is the best-ranked non-ROMANTIC core other than primary if it is within 3 points of primary, else null. `weight` is 70 with a secondary, else 100. Romantic never supports (same rule as today).
- `computeCore(answers)` keeps its signature and return shape.

### 4.3 Deck binding (`src/lib/coreMap.ts`)

Exact v7 map, primary then secondary (`null` = none):

```ts
export const CORE_MAP: Record<string, [CoreId, CoreId | null]> = {
  F01:["ROMANTIC","MONEY"], F02:["ROMANTIC","PSYCH"], F03:["ROMANTIC","TRAINER"], F04:["PSYCH",null],
  F05:["ROMANTIC","FRIEND"], F06:["ROMANTIC","TRAINER"], F07:["PSYCH",null], F08:["TRAINER",null],
  F09:["FRIEND",null], F10:["ROMANTIC","TRAINER"], F11:["MONEY",null], F12:["FRIEND",null],
  F13:["MONEY","FRIEND"], F14:["ROMANTIC",null], F15:["ROMANTIC","PSYCH"], F16:["ROMANTIC","MONEY"],
  M01:["ROMANTIC","MONEY"], M02:["ROMANTIC","MONEY"], M03:["ROMANTIC","FRIEND"], M04:["ROMANTIC","PSYCH"],
  M05:["ROMANTIC","MONEY"], M06:["MONEY",null], M07:["ROMANTIC","FRIEND"], M08:["TRAINER",null],
  M09:["TRAINER","PSYCH"], M10:["FRIEND",null], M11:["PSYCH",null], M12:["ROMANTIC","TRAINER"],
  M13:["PSYCH",null], M14:["ROMANTIC",null], M15:["FRIEND","TRAINER"], M16:["ROMANTIC",null],
};
export const DECK_HIDDEN: Record<string, CoreId[]> = { F01: ["MONEY"] }; // hide F01 from these core decks
export function castsAs(id: string, core: CoreId): boolean;
```

`deckTemplates(templates, gender, excluded, core)` filters gender, then `castsAs(t.id, core)`, then drops `DECK_HIDDEN` hits and `excluded`. `buildCoreDeck(templates, gender, excluded, ranked)` tries `ranked[0]`, then `ranked[1]`, then `ranked[2]` until a non-empty deck appears (D4). Order the result with the existing `orderDeck`. Expected first-run deck sizes per gender: ROMANTIC 9; the others 3 to 5. A unit test asserts these counts from the map.

A missing manifest id in `CORE_MAP` is a build error: add a unit test that every manifest template id has a map entry.

### 4.4 Option cards (Q5 to Q9)

`QuestionCards({ options, index, onSelect, ariaLabel })` renders a vertical stack of 4 full-width cards.
- Semantics: `role="radiogroup"` with `aria-label`; each card `role="radio"`, `aria-checked`. Roving tabindex. Arrow keys move focus, Space or Enter selects.
- Selected card: accent border, check mark, 150 ms scale 0.98 to 1. No slider track, no line anywhere.
- On select: call `onSelect(i)`; the page dispatches `SET_ANSWER` (index) with the existing invalidation-and-toast logic, waits 350 ms, then `router.push(next)`. Tapping another card within 350 ms cancels and restarts the timer. The Continue button is removed on these five screens. Back stays as today.
- Minimum text size 17px; card min-height 64px.

Copy (`src/lib/copy.ts`). Q5 and Q8 keep their existing questions and stops, now as option labels. New or changed:

```ts
q6: { question: "A good conversation ends with", options: ["Feeling understood", "Feeling lighter", "Seeing it clearly", "Knowing what to do"] },
q7: { question: "When you're stuck, what actually gets you moving?", options: ["Someone patient", "Someone who believes in me", "Someone who makes it fun", "Someone who won't let it go"] },
q9: { question: "When something's off, what do you want most?", options: ["Help understanding it", "Help forgetting it for an hour", "Someone to just stay", "A way to fix it, today"] },
```

### 4.5 Tiebreaker (`/onboarding/questions/tiebreak`)

After Q11, the interests page calls `computeCore`. If `needsTiebreak` returns a pair, route to `questions/tiebreak`; otherwise to `matching`. The page is not part of the Q5 to Q11 progress pips.

Screen: question "It's 11pm and it's been a rough day. Which message would you rather get?" and two cards, left/right order randomised per mount. Tapping one sets `answers.tb` and auto-advances to `matching` after 350 ms. Lines, one per core:

```ts
tiebreak: {
  question: "It's 11pm and it's been a rough day. Which message would you rather get?",
  lines: {
    ROMANTIC: "you went quiet today. i noticed. tell me the part you didn't say.",
    PSYCH: "Let's slow it down. What's the thought that keeps coming back?",
    FRIEND: "okay. emergency snacks and a terrible movie. then you tell me everything",
    MONEY: "Right. List what's actually urgent. We'll sort the rest tomorrow.",
    TRAINER: "Water. Shoes on. Ten-minute walk. Then we talk.",
  },
},
```

Invalidation: changing any of q5 to q10 clears `tb`. Back from `matching` goes to `tiebreak` only if `tb` is set.

### 4.6 Deck tutorial

Show when `flow.kind === "first" && !flow.tutorialShown && flow.deckIndex === 0` on first mount of the deck, after the first card has rendered. Dispatch `SET_TUTORIAL_SHOWN` when it ends or is skipped. A "?" icon button (44px hit area, `aria-label="Show how this works"`) in the deck's top-right replays it any time.

While running: pointer and keyboard input to the card are ignored, and dwell accumulation is paused (do not count tutorial time toward the first card's dwell).

Choreography, animating `transform`, `opacity` and a `filter` on the deck backdrop wrapper only (not the card image):

| ms | Card | Screen | Glyphs | Caption |
|---|---|---|---|---|
| 0 to 600 | Wiggle: rotate ±3°, 3 cycles | none | none | none |
| 600 to 2600 | translateX(+38%) rotate(8°), ease-out | `brightness(1.12) contrast(1.15) saturate(1.2)` | 6 small green check marks (#3FA66B, 20 to 28px) drift up around the card, staggered 120 ms | "Swipe right to keep" |
| 2600 to 3200 | Return to centre | filter back to none | fade out | none |
| 3200 to 5200 | translateX(-38%) rotate(-8°) | `grayscale(0.9) brightness(0.72)` | 6 small red crosses (#D0463B) drift down, staggered | "Swipe left to pass" |
| 5200 to 5800 | Return to centre | filter back to none | fade out | none |

- Haptics: at 0 ms call the existing `vibrate([30, 40, 30])` helper; it is a no-op where unsupported.
- Skip: text button "Skip" appears at 1500 ms, bottom centre; ends immediately and restores the card and filters.
- Captions are 20px, centred under the card, and use `aria-live="polite"`.
- Reduced motion: no movement. Show a static overlay with two panels side by side (check and "Swipe right to keep", cross and "Swipe left to pass") and a "Got it" button.

### 4.7 Constellation (`/onboarding/choosing`)

On mount: compute `proposeFor(flow)` exactly as today (the winner), dispatch `PROPOSE`, then play the animation, then `router.replace("/onboarding/proposal")`. Also accept `?short=1` for the redraw variant.

Faces in the ring: the liked faces (max 9). With zero likes, the top 5 by dwell. With exactly one face, skip the ring (see below). The winner is always in the ring.

Full version, about 4200 ms:
1. **0 to 1200 ms, gather.** Round avatars (72px, the manifest `avatar`) fly in from the edges to a ring, radius `min(32vw, 32vh)`, and the ring orbits slowly (one full turn per 12 s). Background: current deck background darkened to 85%.
2. **1200 to 3000 ms, heartbeat.** Three beats slowing from 72 to 48 bpm. Each beat pulses the ring (scale 1 to 1.06 to 1) and a soft ring of light expands from the centre. After each beat, one or more non-winners fade to 0 so that only the winner remains at the third beat.
3. **3000 to 4200 ms, reveal.** The winner eases to the centre and scales to 160px. A radial flood in the winner's `palette` hex grows from the avatar to cover the screen (clip-path circle, 900 ms), then route.

One face: skip gather; do the three beats on the single centred avatar, then the flood.

Short version (`?short=1`, used after "Show me someone else"): about 1500 ms. Skip gather, one beat, then the flood.

Sound (`src/lib/sound/heartbeat.ts`), only if `state.user.soundOn`:
- Create an `AudioContext` on mount and call `resume()`. If it stays suspended, run silently. Never block the animation on audio.
- Each beat: a "lub-dub" of two sine thumps (60 Hz then 50 Hz, 110 ms apart), each with a 5 ms attack and 180 ms exponential decay, peak gain 0.5, through a lowpass at 180 Hz.
- Reveal: a triangle-wave glissando 440 to 880 Hz over 900 ms at gain 0.06, then a soft major chord (C5, E5, G5 sines) at gain 0.05 each, 1.2 s decay, with a 250 ms feedback delay at 0.3 for air.
- Close the context 1.5 s after routing.

Reduced motion: no orbit, no flight, no flood. Cross-fade the ring to the winner over 600 ms, then route. Play only the final chord.

`proposal/page.tsx`: "Show me someone else" dispatches `REDRAW` as today, then routes to `/onboarding/choosing?short=1` instead of re-rendering in place.

### 4.8 Rivers labels

In `ChoiceRivers.tsx`, remove the `glabText` span (the label text and its selection dot) from `label()`. Keep the `gsub` sub-label when a side is disabled. Keep both zone buttons' `aria-label`s. Remove now-unused CSS.

### 4.9 Migrations

**State (`src/lib/migrate.ts`, v2 to v3):**
- Rewrite `core.primary`, `core.secondary` and every `core.ranked[].id` on companions and on `flow` with the D1 map. Merge duplicate `ranked` entries created by ANAY→FRIEND by keeping the higher score.
- If `flow` exists and has any non-integer value in q5 to q9, clear q5 to q9, `tb`, `core`, deck fields and proposal fields, and set `flow.step = "questions/disclosure"`. Integer answers stay.
- Add `tb: null` to every `answers` object and `tutorialShown: false` to `flow`.

**Database (`20260930000001_five_cores.sql`):** one `update public.companions` that rewrites `core->'primary'`, `core->'secondary'` and each `core->'ranked'[*].id` with the same map. It must be idempotent: running it twice changes nothing. Old stored `answers` floats are left alone; they are historical only.

`copy.ts`: re-key `OPENERS` and `REPLIES` from old ids to new (KIAAN→ROMANTIC and so on). Drop the ANAY entries. Fallbacks that referenced `MEHER` now reference `PSYCH`.

## 5. Edge cases

1. **Round two with everything parted in the user's core:** D4 fallback. If all three ranked decks are empty, keep today's empty-pool behaviour.
2. **User answers, reaches the tiebreak, goes back and changes Q7:** `tb` clears, recompute on the next pass through interests.
3. **Tutorial and the undo button:** undo is disabled while the tutorial runs.
4. **Tutorial on a very short deck** (1 card): still plays; the card returns to centre and stays.
5. **Constellation on refresh mid-animation:** the page recomputes from `flow` and replays; `PROPOSE` must be idempotent (same winner on replay because `proposeFor` reads stored state; if it uses randomness, seed it from `flow.proposalsSeen` and the liked list).
6. **Sound off:** no `AudioContext` is created at all.
7. **Tab hidden during the Constellation:** on `visibilitychange` to hidden, jump straight to routing.
8. **Keyboard users on option cards:** full operation without a pointer, visible focus ring (3px).

## 6. Tests

**Unit (`tests/unit/fiveCores.test.ts`):**
- Each pressure with all Q5 to Q9 answers set to an index that gives its owner no points: the owner still ranks first or second.
- Answer sets that produce an exact ROMANTIC tie: ROMANTIC wins with no tiebreak.
- A close non-ROMANTIC call returns the right pair from `needsTiebreak`, and setting `tb` resolves it.
- `assignCore` never returns ROMANTIC as secondary.
- `CORE_MAP` covers every manifest id. Deck sizes per gender for each core match the map; F01 never appears in a MONEY deck; F01 appears in the woman ROMANTIC deck.
- D4 fallback order.

**Updated:** `engine.test.ts` (remove distance tests), `migrate.test.ts` (v2 to v3 cases in 4.9, including ANAY merge), `copy.test.ts`, `allyReducer.test.ts`, RLS fixtures that seed old core ids.

**E2E (`tests/e2e/e27-b1-onboarding.spec.ts`):**
1. Gender screen has no visible "Woman"/"Man" text; `getByRole("button", { name: "A woman" })` still commits. Screenshot `e27-01-rivers`.
2. Q5 to Q9: `getByRole("radio", ...)` taps auto-advance; no slider role exists. Screenshot `e27-02-cards`.
3. A seeded close-call answer set reaches the tiebreak and then matching. Screenshot `e27-03-tiebreak`.
4. First deck: the tutorial runs, input is locked, Skip ends it, "?" replays it. With reduced motion, the static overlay shows. Screenshot `e27-04-tutorial-right` at about 1800 ms.
5. Finishing the deck plays the Constellation and lands on the proposal. "Show me someone else" plays the short version. Screenshot `e27-05-constellation` at about 2000 ms.
6. A ROMANTIC woman deck contains F01; a seeded MONEY answer set's woman deck does not.

Update `tests/e2e/helpers.ts` and `e1-first-run.spec.ts` for card questions. Keep role-based selectors.

**Full suite:** `npm run lint`, `npm test`, `npm run build` with no env vars, `npm run test:rls` against the local Docker Supabase stack, `npm run e2e`.

## 7. Out of scope

Anything in chat, the LLM, the ledger, trust levels, or memory (all B2). Matching page copy. The Q10 dial. Round-two leave flow.
