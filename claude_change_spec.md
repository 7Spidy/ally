# claude_change_spec.md

**Project:** Ally, AI companion app
**Task:** Rebuild the product in Next.js 15 and ship it live at the existing Vercel project (hi-ally.vercel.app)
**Version:** 3.0, 19 September 2026. Supersedes every earlier spec in this repo.
**Status of the old builds:** `ally-onboarding.html` is the first-run onboarding only (splash through one chat message). No version of the multi-companion hub (home, round two, ledger, parting, settings) has ever been built, in any stack. This document specifies both: the full onboarding, ported, and the full hub, built for the first time.

---

## 1. Context and goal

Ally pairs a user with an AI companion. The companion has two layers: a **core** (one of six, temperament, never shown to the user) and a **visual persona** (one of 32, the face the user picks). This asymmetry is the product.

This build is a framework migration and a feature build at once:

1. **Port** the existing onboarding — splash, consent, 11 questions, matching, 16-card deck, proposal, lock, reveal, first chat — from the single-file vanilla build into Next.js, preserving every behaviour exactly.
2. **Build**, for the first time, everything after the lock: a home screen, real navigation, up to three independent companions, a second onboarding round, paid slot unlocks, permanent parting, a message ledger with a day-pass paywall, and settings.

There is still no backend, no LLM, no real payment processor and no real auth. This is a fully working client prototype, framework-shaped so that swapping in Supabase and a real model later is additive, not a rewrite.

**Reference material already in the repo, treated as normative wherever this document doesn't override it:**
- `ally-onboarding-prd-v1.1.html` — the product spec for the onboarding screens: exact copy, the matching algorithm's intent, the 32-persona manifest shape, the design language.
- `ally-onboarding.html` — the working reference implementation. Its `#ally-engine` script block (matching, deck ordering, dwell, propose, the age gate) and `#ally-app` script block (screen wiring, persistence, sound) are the logic to port. Port the algorithms verbatim. Do not "improve" the matching math, the dwell weighting, or the deck ordering.
- `ally-onboarding.test.js` — the 20 existing engine tests. Every assertion in it must still pass against the ported TypeScript engine, unchanged, except test 9 (§13.1).
- `assets/manifest.json` and `assets/` — unchanged, copied into `public/assets/`.

Everything below §1 is net new: it did not exist in any prior build.

---

## 2. Stack and hard constraints

| Area | Decision |
|---|---|
| Framework | Next.js 15, App Router |
| Language | TypeScript, strict mode |
| React | 19, matching Next 15 |
| Hosting | The existing Vercel project at **hi-ally.vercel.app**, connected to `7Spidy/ally` |
| Rendering | No `output: 'export'`. Standard Next.js, so API routes are available later for Supabase and Heart. Every screen in this build is a Client Component; nothing here needs the server yet |
| Styling | Global CSS plus one CSS Module per screen, porting the existing hand-authored tokens and the Bleed scrim near-verbatim. No Tailwind, no component library |
| State | React Context plus `useReducer`. No Redux, no Zustand |
| Persistence | `localStorage` only, single device. No Supabase, no cookies, no server session |
| Auth | Stubbed. The account sheet collects a name and a contact string, validates format only, sets `user.accountAt`. No OTP, no verification |
| Payments | Mocked. Any tap on an unlock or day-pass button succeeds locally. No Razorpay SDK |
| Chat | No LLM. Canned openers and a four-reply rotation per core, exactly as in §7 |
| Package manager | npm |
| Unit tests | Vitest |
| E2E tests | Playwright, Chromium, 390×844 |
| Linting | Next's default ESLint config (`next/core-web-vitals`, TypeScript), zero warnings on `next build` |
| Minimum font size | 15.5px, nothing smaller, anywhere including the debug panel |
| Language | English only |
| Accessibility | Visible focus rings, `prefers-reduced-motion` respected, every control reachable by keyboard, every sheet traps focus and closes on Escape |
| Time | All date and time reads go through one injectable `now()` in `src/lib/clock.ts`. No bare `Date.now()` or `new Date()` elsewhere |
| Day boundary | Midnight in `Asia/Kolkata`, via `Intl.DateTimeFormat`, regardless of device timezone |

### 2.1 Do not

- Do not surface a core name, a score, a percentage, a trust level, or a message count above 10, in any user-visible string.
- Do not add screens, rows, toggles, chips or copy not specified here or in the referenced PRD.
- Do not change any copy string in §6 or in the PRD's screens.
- Do not add a tab bar, a hamburger, or a home button icon. Home is reached by back.
- Do not add horizontal swipe between chats.
- Do not use red, warning triangles or exclamation marks on any destructive or blocking surface.
- Do not add a spinner.
- Do not delete `ally_session` or `ally-onboarding.html` from the repo. Both stay as historical reference.
- Do not merge to `main`, do not run `vercel --prod`, do not commit or push, without explicit confirmation (§16).

---

## 3. Repository layout

Work in a new branch, `nextjs-migration`, off `main`.

```
/
  app/
    layout.tsx                       ← root layout: fonts, AllyProvider, SheetHost, global CSS import
    page.tsx                         ← "/" — boot decision, splash, then redirect
    globals.css
    onboarding/
      layout.tsx                     ← phone chrome, progress rule, back/X handling shared by all onboarding routes
      consent/page.tsx
      location/page.tsx
      gender/page.tsx
      name/page.tsx
      birthday/page.tsx
      questions/
        disclosure/page.tsx
        warmth/page.tsx
        push/page.tsx
        structure/page.tsx
        nostalgia/page.tsx
        pressure/page.tsx
        interests/page.tsx
      matching/page.tsx
      deck/page.tsx
      choosing/page.tsx
      proposal/page.tsx
      reveal/page.tsx
    home/page.tsx
    chat/[id]/page.tsx
    profile/[id]/page.tsx
    settings/
      page.tsx
      notifications/page.tsx
      privacy/page.tsx
      how/page.tsx
    blocked/page.tsx
  src/
    lib/                             ← pure, no DOM, no localStorage, no Date() — unit tested directly
      clock.ts
      config.ts
      engine.ts                      ← ported verbatim from #ally-engine
      ledger.ts
      migrate.ts
      copy.ts                        ← every string in §6, the PRD's copy, PRESENCE, REPLIES, OPENERS
    state/
      schema.ts                      ← TypeScript types for §4
      allyReducer.ts                 ← the one reducer: onboarding answers, companions, ledger actions
      AllyProvider.tsx               ← Context + useReducer + localStorage persistence + migration on mount
      SheetProvider.tsx              ← sheet stack, §9.2
      useAlly.ts, useSheet.ts        ← hooks
    components/
      Phone.tsx, StatusBar.tsx, HomeBar.tsx, GlassButton.tsx, Avatar.tsx
      CompanionCard.tsx, AddCard.tsx, Pips.tsx
      ChatHeader.tsx, MessageList.tsx, Composer.tsx, LastBar.tsx
      Sheet.tsx, ConfirmSheet.tsx, AccountSheet.tsx, IntroSheet.tsx, UnlockSheet.tsx,
        LeaveSheet.tsx, PaywallSheet.tsx, SwitcherSheet.tsx, PartSheet.tsx, DeleteSheet.tsx
      onboarding/                    ← QuestionSlider, QuestionDial, QuestionTiles, DeckCard, VideoProposal, etc.,
                                        ported 1:1 from the existing screens
    debug/DebugPanel.tsx
  tests/
    unit/  clock.test.ts  engine.test.ts  ledger.test.ts  migrate.test.ts  copy.test.ts
    e2e/   *.spec.ts
  public/assets/                     ← copied from /assets, unchanged
  vitest.config.ts
  playwright.config.ts
  package.json
  tsconfig.json
  next.config.ts
  ally-onboarding.html               ← unchanged, kept as reference
  ally-onboarding-prd-v1.1.html      ← unchanged, kept as reference
  ally-onboarding.test.js            ← unchanged, kept as reference; superseded by tests/unit/engine.test.ts
  claude_change_spec.md              ← this file
  vercel.json                        ← delete; Next.js on Vercel needs no rewrite rule
```

`src/lib/*` files take every external input as a parameter (a storage object, a clock function, a templates array). No file under `src/lib/` imports `react`, touches `window`, or calls `Date` directly.

---

## 4. State schema

One shape, held in `AllyProvider`'s reducer state and mirrored to `localStorage` under key `ally_v2` on every dispatch.

```ts
// src/state/schema.ts
export type CoreId = 'KIAAN' | 'MEHER' | 'ANANYA' | 'VEER' | 'PRIYA' | 'ANAY';
export type Pressure = 'money' | 'health' | 'head' | 'alone' | 'notgood' | 'change';
export type Gender = 'woman' | 'man';

export interface Answers {
  q5: number | null; q6: number | null; q7: number | null; q8: number | null; q9: number | null;
  q10: Pressure | null; q11: string[];
}

export interface Core { primary: CoreId | null; secondary: CoreId | null; weight: number | null; ranked: { id: CoreId; score: number }[]; }

export interface Companion {
  id: string;                         // 'c_' + base36 timestamp
  templateId: string;                 // 'F01'..'M16'
  deckGender: Gender;
  answers: Answers;
  core: Core;
  createdAt: number; lastOpenedAt: number;
  status: 'active' | 'parted';
  partedAt: number | null; purgeAt: number | null;
  messages: { who: 'them' | 'me'; text: string; at: number }[];
  exchanges: number; unread: number;
  notify: boolean; sound: boolean;
}

export interface Ledger {
  slotsUnlocked: number;              // 1..3
  unlocks: { slot: number; at: number; amount: number }[];
  parted: string[];                   // templateIds, permanent
  day: string;                        // Asia/Kolkata YYYY-MM-DD
  freeUsed: number;
  pass: { startedAt: number; endsAt: number; used: number } | null;
  passes: { startedAt: number; amount: number }[];
}

export interface OnboardingFlow {
  kind: 'first' | 'round2';
  step: string;                       // route segment name, e.g. 'gender', 'questions/warmth'
  cityRaw: string; region: string | null; deckGender: Gender | null;
  displayName: string; dob: string | null; age: number | null;   // 'first' only
  answers: Answers;
  core: Core;
  deckOrder: string[]; deckIndex: number; deckHistory: string[];
  dwell: Record<string, number>; liked: string[]; expanded: string[]; poolRemoved: string[];
  redraws: number; canRedraw: boolean;
  proposed: string | null; proposalsSeen: number; proposalMode: string | null;
}

export interface AllyState {
  v: 2;
  savedAt: number;
  user: {
    consentAt: number | null; consentMarketing: boolean;
    accountAt: number | null; accountContact: string | null; accountKind: 'phone' | 'email' | null;
    accountDismissed: number;
    soundOn: boolean; unmuted: boolean;
  };
  companions: Companion[];
  ledger: Ledger;
  flow: OnboardingFlow | null;
}
```

Selectors, in `src/lib/engine.ts` or a `selectors.ts` beside it, all pure:
`active(s)`, `byId(s, id)`, `lastOpened(s)`, `excludedFaces(s)` (union of active `templateId`s and `ledger.parted`), `pool(s, templates, gender)`, `firstName(templateId)`.

### 4.1 Migration

`src/lib/migrate.ts`, `migrate(storage, now): AllyState`.

1. If `localStorage.ally_v2` exists and parses, return it.
2. Else if `localStorage.ally_session` exists and parses:
   - If `state.locked` is set: build one `active` companion from it (`templateId`, `answers`, `core`, `deckGender`, `messages`, `exchanges`; `createdAt` = `lockedAt` or `savedAt`; `lastOpenedAt` = `savedAt`). Copy user fields. `flow` is `null`. `ledger.slotsUnlocked` is 1.
   - Else: no companions, and `flow = { kind:'first', step: <mapped from state.screen>, ...carried fields }`.
   - Write `ally_v2`. Never modify or remove `ally_session`.
3. Else return a fresh `AllyState` with `flow = { kind:'first', step:'consent', ... }`.

Migration is idempotent: running it twice with the same clock produces byte-identical `ally_v2`.

### 4.2 Boot decision

Runs once, in `app/page.tsx`, on mount, after `migrate()`.

| Condition | Route |
|---|---|
| `ally_blocked_until` in the future | `/blocked` |
| no companions ever, no account, `flow.kind==='first'` | resume by the existing 7/30-day rule from the PRD, at `flow.step`; past 30 days, reset `flow` to `consent` |
| at least one active companion | splash (returning variant, §10.2), then `/chat/[lastOpened]`, `router.replace` |
| companions exist, none active | splash (returning), then `/home` |

A user with any companion, active or parted, or with an account, never expires. Discard `flow.kind==='round2'` silently on boot before applying this table.

### 4.3 Purge

On every mount of `AllyProvider` and on every route change, for each companion with `status==='parted'` and `purgeAt <= now()`: clear `messages`, `answers`, `core`, set `unread` to 0. Leave `templateId` in `ledger.parted` forever, even if the companion record is later dropped from the array.

---

## 5. Config

`src/lib/config.ts`. Every number below is a named export, imported everywhere it's used. Nothing is inlined elsewhere.

```ts
export const FREE_DAILY      = 100;
export const PASS_HOURS      = 24;      // rolling from purchase
export const PASS_CAP        = 2000;    // hidden, never rendered
export const PRICE_SLOT_2    = 199;     // INR, placeholder
export const PRICE_SLOT_3    = 349;     // INR, placeholder, must exceed PRICE_SLOT_2
export const PRICE_DAY_PASS  = 49;      // INR, placeholder
export const MAX_COMPANIONS  = 3;
export const CHIP_THRESHOLD  = 10;
export const PART_PURGE_DAYS = 30;
export const SPLASH_RETURN_MS = 900;
export const LONG_PRESS_MS    = 500;
```

---

## 6. Copy, new screens, verbatim

Onboarding screen copy (splash through the first chat message, and the account sheet) is unchanged from `ally-onboarding-prd-v1.1.html`. Port it exactly. The table below is everything new, for the hub. `{persona}` is the companion's first name, `{obj}` is `her`/`him` from the template's gender, `{time}` is `hh:mm am/pm`, `{price}` is a config value with no decimals.

| Surface | Element | String |
|---|---|---|
| home | chip, free, ≤10 left | `{n} left today` |
| home | chip, pass active | `Day pass until {time}` |
| home | card unread badge | `{n} new` |
| home | add card title | `Meet someone new` |
| home | add card body, ≥1 active | `A few questions, a new face. They won't know about each other.` |
| home | add card body, 0 active | `A few questions, a new face.` |
| home | add card action | `Start` |
| home | cap card title / body | `That's three` / `Three companions is the most Ally keeps at once.` |
| home | exhausted card title / body | `You've met everyone` / `There are no new faces left to meet.` |
| intro sheet | heading | `Someone new` |
| intro sheet | body 1 | `The same questions as last time, minus the ones about you. Answer as you are now. Then a new set of faces.` |
| intro sheet | body 2, 1 active | `{A} won't know. Nothing you tell one companion ever reaches another.` |
| intro sheet | body 2, 2 active | `{A} and {B} won't know. Nothing you tell one companion ever reaches another.` |
| intro sheet | body 2, 0 active | not rendered |
| intro sheet | buttons | `Start` / `Not now` |
| unlock sheet | heading | `Make room for someone new` |
| unlock sheet | body, slot 2 / slot 3 | `A second companion is a one-time unlock. The slot stays yours.` / `A third companion is a one-time unlock. The slot stays yours.` |
| unlock sheet | price row / buttons | `One-time` / `₹{price}` — `Unlock with UPI` / `Not now` |
| unlock | toast | `Unlocked. Let's find them.` |
| round two | sub-line on gender + every question | `Things may have changed since last time` |
| round two | gender option, pool empty | `No new faces left here` |
| leave sheet | heading / body | `Leave?` / `Your answers won't be saved.` |
| leave sheet | buttons | `Keep going` / `Leave` |
| chat | since-you-left divider | `Since you left` |
| chat | bar, 1 free left | `1 free message left today` / `Get a day pass` |
| chat | bar, 0 free left | `You're out of free messages for today` / `Get a day pass` |
| chat | bar, pass cap hit, replaces composer | `{persona}'s done for the night. Back tomorrow.` |
| paywall sheet | heading / body | `Out of messages for today` / `Free messages come back at midnight. Or keep talking now.` |
| paywall sheet | price row / buttons | `Day pass, 24 hours` / `₹{price}` — `Get a day pass` / `Wait till tomorrow` |
| day pass | toast | `Day pass on until {time}.` |
| switcher | heading / current tag / last row | `Switch to` / `Here now` / `Home` |
| chat | overflow sheet rows | `Profile` / `Home` |
| profile | rows | `Together since` / `{d MMMM}` (+ ` {yyyy}` if not current year) — `Notifications` / `Message sound` |
| profile | link | `Part ways with {persona}` |
| part sheet | heading | `Part ways with {persona}?` |
| part sheet | body | `Your chats with {obj} are deleted after 30 days. You won't be able to choose {obj} again, and this can't be undone.` |
| part sheet | field label / buttons | `Type {persona} to confirm` — `Keep {persona}` / `Part ways` |
| settings | title / groups | `Settings` — `You` / `Companions` / `Plan` |
| settings | rows | `Name` / `Signed in with` (`Phone` or `Email`) |
| settings | plan row, free / pass | `Free` / `{n} left today` — `Day pass` / `Until {time}` |
| settings | rows | `Notifications` / `Privacy and data` / `How Ally works` |
| settings | footer | `Ally is an AI. Every character here is fictional.` |
| notifications | title | `Notifications` (one toggle per active companion, labelled `{persona}`) |
| privacy | title / rows | `Privacy and data` — `Download my data` / `Delete everything` |
| delete sheet | heading / body | `Delete everything?` / `Your companions, chats and answers are removed from this device. This can't be undone.` |
| delete sheet | buttons | `Keep my data` / `Delete everything` |
| how | title | `How Ally works` |
| how | body, four paragraphs, in order | `You picked their face. The way they talk came from your answers.` / `The questions at the start shaped how quickly they open up, how hard they push and how they handle a bad day. The first few weeks of talking can shift that a little.` / `Each companion is separate. Nothing you tell one reaches another.` / `None of them are real people. Ally is an AI and every character is fictional.` / `You can download or delete your answers any time in Privacy and data.` |

---

## 7. Content

### 7.1 Openers and matching

`OPENERS`, `WEIGHTS`, `AXES`, `PRESSURES`, `DISCLOSURE_STOPS`, `STRUCTURE_STOPS`, `INTEREST_TAGS`, `userVector`, `scoreCores`, `assignCore`, `deckTemplates`, `overlap`, `orderDeck`, dwell handling and `propose` all port verbatim from `#ally-engine` in `ally-onboarding.html` into `src/lib/engine.ts`, typed. `deckTemplates` gains an `excluded: Set<string>` parameter (§8.4). Every other signature and formula is unchanged.

### 7.2 Presence

One static string per template, two variants. Day is 07:00–19:59 `Asia/Kolkata`, night is the rest. Shown under the name in the chat header and on home cards, nowhere else. Never a timestamp.

| id | day | night |
|---|---|---|
| F01 | At the practice, drafting | Around, sketching at home |
| F02 | At the wheel, hands full | Around, the kiln's cooling |
| F03 | In clinic rotations | Around, pretending to study |
| F04 | With clients, replies between sessions | Around, off the clock |
| F05 | Around, slow morning after a gig | At a venue, replies at soundcheck |
| F06 | Out on the water, patchy signal | Around, logging samples |
| F07 | In the edit suite | Around, one more cut |
| F08 | At college, then rehearsal | Around, winding down |
| F09 | Teaching lessons | Around, playing something new |
| F10 | In the field, signal comes and goes | Around, back at base camp |
| F11 | At work, replies at lunch | Around, probably at a board |
| F12 | In the pastry kitchen | Around, feet up |
| F13 | In design reviews | Around, still fiddling with a mockup |
| F14 | At the repair bench | Around, developing a roll |
| F15 | In the water, replies after dives | Around, rinsing gear |
| F16 | Up a scaffold, painting | Around, printing a run |
| M01 | Around before service | In the middle of service |
| M02 | Running the hotel | Around, the courtyard's quiet |
| M03 | In class, half listening | Around, grinding problems |
| M04 | Around, slow start | In the studio, replies late |
| M05 | At the plant | Around, in the garage |
| M06 | At the mill | Around, looking at weaves |
| M07 | At the department | At the telescope, replies late |
| M08 | At the range | Around, after practice |
| M09 | On a trail, patchy signal | Around, back at camp |
| M10 | In class | At the stall with family |
| M11 | In a mixing session | Around, practising |
| M12 | In the water with students | Around, waxing boards |
| M13 | Out on the estate | Around, cupping a new roast |
| M14 | At the studio | Around, sketching soles |
| M15 | Around, slow morning | In the studio, replies late |
| M16 | At the cutting table | Around, pressing a jacket |

### 7.3 Replies

Four replies per core. Index 0 is the existing `REPLIES` string from `ally-onboarding.html`. For a companion's Nth exchange (1-indexed), use `pool[(N - 1) % 4]`. Deterministic, no randomness. Typing delay stays 1200–1800ms.

| core | 1 | 2 | 3 |
|---|---|---|---|
| KIAAN | I like it when you tell me things like that. What happened next? | Okay. I'm listening properly now, phone face down. Go on. | You don't have to make it sound neat for me. Say it the messy way. |
| MEHER | That makes sense given everything you've described. What did you feel first, before you started explaining it to yourself? | Let's slow that down. Which part of it is heaviest right now? | You're being quite hard on yourself in how you tell that. Would you talk to a friend that way? |
| ANANYA | Good. Put a number on it, even a rough one. It's easier to fight something that has a size. | What's the deadline on that, the real one, not the one you set to feel busy? | Two options on the table, then. Which one would you regret less in six months? |
| VEER | Fine. What's the smallest version of it you can do before you sleep tonight? | Stop negotiating with it. Pick the time. Tell me when it's done. | That's an explanation, not a plan. Give me the plan. |
| PRIYA | Wait, that's actually huge. Why are you saying it like it's nothing? | Okay, I'm fully on your side here, but tell me the bit you're leaving out. | Honestly, you're doing better than you think. Keep going, I want the whole story. |
| ANAY | That reminds me of how things used to feel. Slower. Do you miss that too? | Some things you only understand looking back. What do you think you'll make of this in a year? | Tell me more. I like hearing how you think about this stuff. |

If the user leaves before a reply lands, the reply still appends and `unread` still increments.

---

## 8. Flows

### 8.1 First run

Port `app/onboarding/*` screens 1:1 from the PRD and the reference build: consent → location → gender → name → birthday (under-18 → `/blocked`) → the seven questions → matching → deck → choosing → proposal → confirm (sheet) → reveal. On confirm, create a `Companion` (not the old single `locked` field), push it into `companions`, set `flow` to `null`, and `router.replace('/chat/' + id)`. The account sheet (existing exchange-count logic: nudge at 1st and 3rd, block at 7th) is unchanged, now reading `companions[0].exchanges`.

### 8.2 Round two

Entered from the home add card.

1. If `user.accountAt` is null, open the (existing) account sheet over `/home`. It cannot be dismissed here. On success, continue.
2. Open the intro sheet (§6).
3. If `active.length >= ledger.slotsUnlocked`, open the unlock sheet for slot `slotsUnlocked + 1`. `Unlock with UPI` calls the ledger unlock action, shows the toast, continues. `Not now` returns to `/home`. A paid, unused slot stays unlocked.
4. `router.push('/onboarding/gender')` with `flow = { kind:'round2', ... }`. The onboarding layout reads `flow.kind` and:
   - shows the round-two sub-line under every question;
   - replaces the back chevron with an X that opens the leave sheet; `Leave` clears `flow` and routes home;
   - skips consent, location, name, birthday, and the age gate entirely;
   - pre-fills Q11 with the most recent companion's `answers.q11`, editable;
   - computes `pool()` per §8.4 for the gender screen, disabling any gender whose pool is empty with the "No new faces left here" label.
5. Matching, deck, choosing, proposal, reveal proceed exactly as first run. **The core is recomputed from this round's answers with no exclusions** — a duplicate core is allowed.
6. On lock, create the companion, `router.replace('/chat/' + id)`.

### 8.3 Deck pool

```ts
pool(templates: Template[], gender: Gender, excluded: Set<string>) =>
  templates.filter(t => t.gender === gender && !excluded.has(t.id))
```
`orderDeck`, dwell, `propose`, redraws — unchanged, operating on a pool of 1 to 16. Counter reads `{i} of {N}`. `Done` appears after `min(4, N)`.

### 8.4 Add card state

Evaluated in order:

| Condition | Card |
|---|---|
| `active.length === MAX_COMPANIONS` | cap card, no action, `+` pip hidden |
| both gender pools empty | exhausted card, no action, `+` pip hidden |
| otherwise | add card, body variant by active count |

### 8.5 Parting

`Part ways with {persona}` on the profile opens the part sheet. The destructive button is disabled until the typed field matches the first name (trimmed, case-insensitive). On confirm: `status = 'parted'`, `partedAt = now()`, `purgeAt = now() + PART_PURGE_DAYS days`, push `templateId` into `ledger.parted`, `router.replace('/home')`. `slotsUnlocked` is untouched — the freed slot can be reused with no new payment.

---

## 9. Routing

### 9.1 Screens

Real Next.js routes, per the tree in §3. `next/navigation`'s `useRouter`, `usePathname`, and the browser's native back button and gesture all work unmodified — this is the main win over the vanilla build's hand-rolled router.

Back targets:

| From | Back goes to |
|---|---|
| any `/chat/[id]` | `/home` |
| `/profile/[id]` | `/chat/[id]` |
| `/settings` | `/home` |
| `/settings/notifications`, `/settings/privacy`, `/settings/how` | `/settings` |
| any `/onboarding/*`, first run | the previous screen in sequence (existing PRD behaviour) |
| any `/onboarding/*`, round two | X → leave sheet, not the browser back button directly |

Implement each "back goes to X" as an explicit button calling `router.push(X)` — do not rely on `router.back()`, since the actual history stack depends on how the user arrived. The browser/hardware back button should be intercepted with a `popstate` listener that redirects to the same target as the on-screen back button, so Android hardware back and the on-screen chevron always agree.

### 9.2 Sheets

Sheets (`confirm`, `account`, `intro`, `unlock`, `leave`, `paywall`, `switcher`, `part`, `delete`) are not routes. They are an overlay stack in `SheetProvider`, rendered by a single `SheetHost` in the root layout, above whatever route is mounted.

- `openSheet(name, props)` pushes onto the stack and calls `history.pushState(null, '', location.href)` — same URL, a dummy entry.
- A `popstate` listener in `SheetProvider` checks the stack: if non-empty, pop the top sheet and stop; if empty, let the navigation proceed normally.
- Escape closes the top sheet. Each sheet traps focus while open.
- Opening a second sheet while one is open is not used anywhere in this spec; don't build for it.

### 9.3 Answer invalidation

When a first-run or round-two question screen receives a new value for a step that already had a different stored value, apply the existing PRD §10.1 invalidation table to `flow` before advancing (clear `liked`, `dwell`, `proposed`, `deckOrder` etc. as specified there). This is unchanged logic, just triggered from a page's submit handler instead of a custom `go()`.

---

## 10. Screens

Visual system — tokens, spacing, the Bleed scrim, Instrument Serif/Sans — is unchanged from the vanilla build's CSS. Port the CSS into `globals.css` plus per-screen CSS Modules. The screens below are net new; every onboarding screen is a straight port of the existing markup into a Client Component with the same class names.

### 10.1 Accent scope

The old `html.locked` global switch is gone. `--k` (the companion accent) is set as an inline style on the container that needs it: the chat page, the profile page, the part sheet, each home card, and the reveal screen. Everything else — home chrome, settings, round-two screens before lock — uses the base `--fg` accent.

### 10.2 Splash (`app/page.tsx`)

- **First run:** existing PRD splash, plus the logo mark at 64px above the wordmark, scale 0.92→1 / opacity 0→1 over 600ms once (static under reduced motion).
- **Returning:** `--ink` background, logo at 120px, wordmark, footer line, no button, no portraits. Holds `SPLASH_RETURN_MS`, then replaces itself with the boot target from §4.2.

### 10.3 Home (`app/home/page.tsx`)

- Top bar: the ledger chip (left, only when §11 says to show it), the 34px logo (centre), a monogram button (right) showing `displayName[0]`, opening `/settings`.
- Carousel: horizontal scroll-snap, 300×540 cards, `CompanionCard` per active companion in `createdAt` order, then `AddCard`/cap/exhausted. On mount, centre the companion the user came from, or the first card.
- Card: reveal image, `--k` scrim, first name (40px serif), `{city}, {occupation up to first comma, lowercased}`, last message either direction (2-line clamp), presence line, unread badge if `unread > 0`. Click → `/chat/[id]`.
- Pips: 34px avatar per active companion plus a `+`. Ringed pip = centred card. Click scrolls to that card. Arrow keys move focus between cards; Enter opens the focused one.
- Zero-companion state: only the add card, centred, only the `+` pip.

### 10.4 Chat (`app/chat/[id]/page.tsx`)

- Header: glass back button (→ `/home`), 42px avatar, first name (24px serif) with presence underneath, overflow button (→ the overflow sheet, §6). Click on name/avatar → `/profile/[id]`. Long-press (`LONG_PRESS_MS`) on the avatar → switcher sheet.
- `Since you left` divider precedes the first `them` message with `at` later than the previous `lastOpenedAt`; set `lastOpenedAt = now()` and `unread = 0` after render.
- Composer gated per §11.

### 10.5 Profile, settings, sheets

Build as specified in §6 above and the layout described in §10.3–10.4 for shared chrome. `notify` and `sound` are stored per companion; `sound` plays the existing selection tone on a landing reply. `Download my data` triggers a `Blob` download of the whole `AllyState` as `ally-data.json`. `Delete everything` clears `ally_v2`, `ally_session` and `ally_blocked_until`, then reloads to `/`.

---

## 11. Ledger

Pure functions in `src/lib/ledger.ts`, each `(ledger: Ledger, now: number) => ...`:

```ts
rollDay(l, now)      // if dayKey(now) !== l.day: { ...l, day: dayKey(now), freeUsed: 0 }
passActive(l, now)   // l.pass !== null && now < l.pass.endsAt
freeLeft(l, now)     // FREE_DAILY - rollDay(l, now).freeUsed
canSend(l, now)      // passActive ? (pass.used < PASS_CAP ? 'ok' : 'capped') : (freeLeft > 0 ? 'ok' : 'empty')
spend(l, now)        // only when canSend === 'ok'; increments pass.used if passActive, else freeUsed
buyPass(l, now)      // only when no pass active; sets pass = { startedAt: now, endsAt: now + PASS_HOURS*3600000, used: 0 }
unlock(l, amount, now) // slotsUnlocked += 1, capped at MAX_COMPANIONS; append to unlocks
```

UI by state, `n = freeLeft(ledger, now())`:

| State | Home chip | Chat |
|---|---|---|
| no pass, n > 10 | hidden | normal |
| no pass, 2 ≤ n ≤ 10 | `{n} left today` | normal |
| no pass, n = 1 | `1 left today` | normal + the 1-left bar |
| no pass, n = 0 | `0 left today` | out-of-messages bar; composer tap and bar tap both open the paywall sheet |
| pass, used < cap | `Day pass until {time}` | normal |
| pass, used ≥ cap | `Day pass until {time}` | done-for-the-night bar replaces the composer |

A message counts on send, not on reply. A failed send spends nothing. When a pass ends, the table reverts to the free rows for the current day.

---

## 12. Debug panel

`src/debug/DebugPanel.tsx`, opened by a triple-tap on the top-left 60×60px corner of the viewport, available on every route.

**Shows:** current pathname and sheet stack; per companion — templateId, status, core (primary, secondary, weight, all six ranked scores), exchanges, unread, purgeAt; the full ledger; `excludedFaces`; the clock offset; the `flow` summary.

**Actions**, each going through the real reducers, never a direct field write: `Seed companion` (random allowed template through the real engine with a random answer vector), `Free left → 1`, `Free left → 0`, `Start pass`, `Pass used → 1999`, `Clock +1 day`, `Clock +31 days`, `Part all`, `Reset session`, `Copy state as JSON`.

---

## 13. Tests

### 13.1 Unit — Vitest, `tests/unit/`

Port all 20 existing engine tests from `ally-onboarding.test.js` into `engine.test.ts`, same assertions, importing `src/lib/engine.ts` directly instead of the `vm` extraction. Test 9 becomes: `orderDeck` returns exactly `pool.length` templates, all of the requested gender, no duplicates, no omissions, none excluded — run for pool sizes 16, 15, 14 and 1.

New, in the areas below:

**migrate.test.ts**
21. A v1 session with `locked` migrates to one active companion with matching fields.
22. A v1 session without `locked` migrates to `flow.kind==='first'` at the equivalent step.
23. Migration is idempotent and never writes to `ally_session`.

**clock.test.ts / boot logic**
24. Boot with ≥1 active companion → target is `/chat/[lastOpened]` after the returning splash.
25. Boot with 0 active, ≥1 parted → target is `/home` after the returning splash.
26. A companion record with `savedAt` 400 days old still resumes; nothing is ever discarded once a companion or account exists.
27. `flow.kind==='round2'` at boot is discarded before the table in §4.2 is applied.
28. Purge fires at `purgeAt` exactly, not before. The templateId remains in `ledger.parted` after purge.
29. `excludedFaces` is the deduplicated union of active and parted ids.

**ledger.test.ts**
30. Day rollover at 00:00 `Asia/Kolkata`, verified with the device TZ forced to UTC, `America/Los_Angeles` and `Asia/Tokyo`.
31. 100 free sends succeed; the 101st returns `'empty'`.
32. A pass allows 2000 sends; the 2001st returns `'capped'`.
33. A pass never touches `freeUsed`; after it expires, the day's remaining free messages are still usable.
34. A pass ends exactly `PASS_HOURS` after purchase, not at midnight.
35. `buyPass` while a pass is active is a no-op.
36. `unlock` never exceeds `MAX_COMPANIONS`; recorded amounts are `PRICE_SLOT_2` then `PRICE_SLOT_3`.
37. `PRICE_SLOT_3 > PRICE_SLOT_2` (a config guard, not a runtime check).
38. Parting leaves `slotsUnlocked` unchanged; the next round two needs no unlock if a slot is free.

**round two, in engine.test.ts**
39. Same answers across two rounds yield the same core (duplicates allowed by design).
40. The deck never contains an active or parted template, across 1,000 randomised states.
41. Add-card state follows §8.4 across every combination of active count 0–3 and pool emptiness.
42. A gender panel with an empty pool is inert and unselectable.
43. No path creates a `Companion` without an explicit confirm action, first run or round two.

**copy.test.ts**
44. Every string in §6 appears verbatim in `src/lib/copy.ts`.
45. No user-visible string contains a core id, `%`, `score`, `level`, or `2000`.
46. The presence table has 32 ids × 2 non-empty strings. Each `REPLIES` pool has exactly 4 entries.

### 13.2 E2E — Playwright, `tests/e2e/`, 390×844, Chromium, touch enabled

Inject the clock via a test-only `window.__allyClock` override, wired through `src/lib/clock.ts`.

- **E1** Fresh first run to first chat; back to `/home` shows one card and a peeking add card.
- **E2** Reload → returning splash → last chat. Browser back (`page.goBack()`) lands on `/home`.
- **E3** Round two end to end, including the slot-2 unlock, gender, all seven questions, a 15-card deck when same gender, lock, new chat. Home shows 2 cards.
- **E4** A third companion hits the slot-3 unlock at the higher price; home then shows the cap card.
- **E5** Part with companion 2 — gone from home, the switcher and settings; round two needs no unlock; its face is absent from the deck.
- **E6** Part with everyone, reload → returning splash → home zero state.
- **E7** Seed 99 sends, send 1 more → 1-left bar; send again → out-of-messages bar; composer tap opens the paywall; buying a pass re-enables sending.
- **E8** Seed a pass at 1999 used, send 1 → done-for-the-night bar replaces the composer.
- **E9** Long-press the chat avatar → switcher opens; pick a companion → its chat opens; `Home` → `/home`.
- **E10** Keyboard only: splash → home → a chat → settings → How Ally works → back to home.
- **E11** `prefers-reduced-motion`: E1 and E3 complete with no animation except the reveal video.
- **E12** Screenshot every new screen at 390×844 into `tests/e2e/__screens__/`.
- **E13** Across E1–E10, no rendered element computes a font-size below 15.5px.
- **E14** No console errors; no failed network requests other than Google Fonts when offline; no spinner anywhere.

---

## 14. Acceptance

- [ ] `npm run build` succeeds with zero ESLint warnings.
- [ ] `npm test` (Vitest) passes all 46 unit tests. `npm run e2e` passes E1–E14.
- [ ] A v1 `ally_session` from the currently deployed `ally-onboarding.html` migrates correctly and the user lands in their existing chat.
- [ ] Every §6 string ships verbatim; grep confirms no core id, no `2000`, no score reaches any `.tsx` outside `src/lib/`.
- [ ] Nothing renders below 15.5px.
- [ ] Parted faces never reappear in any deck.
- [ ] The app runs correctly at `https://<preview-url>.vercel.app` (an automatic Vercel preview from the `nextjs-migration` branch push) — test the boot, one full first run, and one full round two there, not just locally.

---

## 15. Report back

1. Module and route list with line counts; total first-load JS from `next build`'s own output.
2. Full `npm run build`, `npm test` and `npm run e2e` output.
3. The core distribution across 1,000 random vectors (six-row table), and, across 1,000 simulated round-two users with ±0.15 jitter per axis on their first-round answers, how often round two produced the same core as round one.
4. The Vercel preview URL for this branch.
5. The E12 screenshots, listed by screen name.
6. Every interpretation you made. Do not silently resolve ambiguity — list it, even if trivial.
7. Anything in this spec you think is wrong. Say it plainly.

---

## 16. What not to do without confirmation

Do not merge `nextjs-migration` into `main`. Do not promote any deployment to production (do not run `vercel --prod`, do not change the production alias). Push the branch so Vercel's GitHub integration builds a preview automatically, report the preview URL, and stop.
