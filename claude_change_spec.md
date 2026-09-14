# claude_change_spec.md

**Project:** Ally, AI companion app
**Task:** Build the first-run onboarding prototype
**Source of truth:** `ally-onboarding-prd-v1.1.html` in the repo root. This file is the implementation contract. Where they differ, this file wins.
**Version:** 1.0, 14 September 2026

---

## 1. Context and goal

Ally pairs a user with an AI companion. The companion has two layers:

- A **core**, one of six, which determines temperament, reply rhythm and guardrails. It is computed from the user's answers and **never shown to the user**.
- A **visual persona**, one of 32, which supplies the face, name, city, occupation and a surface layer of vocabulary. The user picks this themselves.

The asymmetry is the product. The user believes they chose everything. They chose the face.

Build the flow from splash to first exchanged message: 14 screens, 11 questions, a real matching engine, a 16-card swipe deck, a video-backed proposal, an explicit lock, a reveal, and one round of chat.

**This is a real prototype, not a clickthrough.** The matching engine scores actual answers. The deck tracks actual dwell time. The same answers produce the same core every time. No hardcoded happy path anywhere.

---

## 2. Hard constraints

| Constraint | Value |
|---|---|
| Output | One file, `ally-onboarding.html`, self-contained, no build step |
| Framework | None. Vanilla JS, no React, no bundler, no npm |
| External requests | Google Fonts only. No CDN libraries, no analytics, no API calls |
| Persistence | `localStorage` for resume only. No backend, no Supabase |
| Viewport | Mobile first, 390 to 430px. Desktop shows a centred 390px phone frame on a dark field |
| Assets | Relative paths into `./assets/`. Never base64 inline |
| Minimum font size | 15.5px. Nothing smaller renders anywhere |
| Language | English only |
| Accessibility | Visible keyboard focus, `prefers-reduced-motion` respected, all controls reachable by keyboard |

### 2.1 Do not

- Do not use `sessionStorage` for anything. Use `localStorage`.
- Do not add a spinner anywhere in the flow. See §9.4.
- Do not surface a core name, a match score, a percentage, or a compatibility figure in any user-visible string.
- Do not add screens, questions, tags, chips or badges not specified here.
- Do not "improve" the copy. It is final. Ship it verbatim.
- Do not add fade-and-slide-up entrance animations to individual elements.
- Do not commit, push, or create a branch. Stop when the build passes.

---

## 3. Repository layout

```
/
  ally-onboarding.html            ← the deliverable, you create this
  ally-onboarding-prd-v1.1.html   ← reference, do not modify
  claude_change_spec.md           ← this file
  /assets
    manifest.json                 ← 32 records, the single source of truth
    /portraits   F01.jpg .. M16.jpg    720 x 900    deck cards
    /avatars     F01.jpg .. M16.jpg    512 x 512    chat header
    /reveal      F01.jpg .. M16.jpg   1080 x 1920   lock screen
    /video       Aditi.mp4 .. Zoya.mp4               per persona
```

### 3.1 manifest.json shape

```json
{
  "version": "1.0",
  "count": 32,
  "interest_vocabulary": { "making": "Making things", "...": "..." },
  "templates": [
    {
      "id": "F01",
      "name": "Ira Malhotra",
      "gender": "woman",
      "region": "North",
      "city": "Delhi",
      "age": 25,
      "palette": "#B03A48",
      "palette_name": "Crimson Clay",
      "occupation": "Junior architect at a small practice",
      "read": "…one line of character read…",
      "technical": false,
      "interests": ["making", "screen"],
      "source_file": "Ira.png",
      "portrait": "assets/portraits/F01.jpg",
      "avatar":   "assets/avatars/F01.jpg",
      "reveal":   "assets/reveal/F01.jpg",
      "video":    "assets/video/Ira.mp4",
      "video_file": "Ira.mp4"
    }
  ]
}
```

**Images are keyed by template ID. Videos are keyed by persona first name.** This asymmetry is intentional and matches files that already exist. Always read the path from the manifest. Never construct one.

**Fetch the manifest at boot.** If the fetch fails, show a single line: `Assets not found. Run this from a local server, not file://` and stop. Do not fall back to embedded data.

---

## 4. Screen sequence

```
0  splash
1  consent
2  location          Q1
3  gender            Q2
4  name              Q3
5  birthday          Q4    → under 18 terminates
6  q_disclosure      Q5
7  q_warmth          Q6
8  q_push            Q7
9  q_structure       Q8
10 q_nostalgia       Q9
11 q_pressure        Q10
12 q_interests       Q11
13 matching                → core computed here
14 deck
15 proposal
16 confirm                 (sheet over 15)
17 reveal
18 chat
19 account                 (sheet over 18)
```

Implement as a state machine with a single `state.screen` index. One transition function. No nested routers.

---

## 5. Copy, verbatim

`{name}` is the user's answer to Q3.

| Screen | Element | String |
|---|---|---|
| splash | headline | `Someone to talk to. Not a chatbot pretending.` |
| splash | action | `Get started` |
| splash | footer | `Ally is an AI. Every character here is fictional.` |
| consent | heading | `Before we start` |
| consent | body | `Ally asks eleven questions to work out who you'd get on with. Your answers stay on this device until you make an account. You can delete everything at any time.` |
| consent | required | `I agree to the Terms and to Ally using my answers to personalise my companion.` |
| consent | optional | `Send me product updates by email.` |
| consent | disclosure | `Ally is an AI. Every character is fictional and generated. Nobody here is a real person.` |
| consent | action | `Continue` |
| location | question | `Where are you?` |
| gender | question | `Who would you rather talk to?` |
| gender | options | `A woman` / `A man` |
| name | question | `What should I call you?` |
| birthday | question | `When's your birthday?` |
| birthday | sub | `Ally will remember.` |
| blocked | heading | `Ally is for adults.` |
| blocked | body | `Come back when you're eighteen.` |
| Q5 | question | `When something's bothering you, what usually happens?` |
| Q5 | stops | `I keep it to myself` / `I tell one person` / `I need to say it out loud` / `Everyone hears about it` |
| Q6 | question | `A good conversation ends with` |
| Q6 | poles | `feeling understood` ←→ `knowing what to do` |
| Q7 | question | `When you're stuck, what actually gets you moving?` |
| Q7 | poles | `Someone patient` ←→ `Someone who won't let it go` |
| Q8 | question | `Your ideal week looks` |
| Q8 | stops | `Open, I'll see what happens` / `Loosely sketched` / `Mostly planned` / `Every hour accounted for` |
| Q9 | question | `Which sounds more like you right now?` |
| Q9 | poles | `I miss how things were` ←→ `I'm only looking ahead` |
| Q10 | question | `What's taking up the most space in your head?` |
| Q10 | stops | `Money and work` / `Health and habits` / `My own head` / `Feeling on my own` / `Not feeling good enough` / `Everything's changing` |
| Q11 | question | `What do you actually spend time on?` |
| Q11 | sub | `Pick up to three` |
| matching | resolve | `{name}, I've got a sense of you.` |
| matching | sub | `Now pick a face.` |
| matching | action | `Show me` |
| deck | done | `Done` |
| proposal | heading | `I think you'd get on with {persona}.` |
| proposal | primary | `Lock them in` |
| proposal | secondary | `Show me someone else` |
| confirm | body | `{persona} is yours from here. You can't swap them later.` |
| confirm | primary | `Yes, it's them` |
| confirm | secondary | `Go back` |
| account | heading | `Save {persona} to your account.` |
| account | sub | `So they're here tomorrow.` |
| recompute | toast | `That changed who you'd meet. Starting the deck again.` |

---

## 6. The matching engine

### 6.1 Core table

Hardcode this. It does not come from the manifest.

```js
const CORES = [
  { id:'KIAAN',  arc:'romantic', warmth:0.95, push:0.25, structure:0.30, disclosure:0.55, nostalgia:0.45, owns:'alone'   },
  { id:'MEHER',  arc:'mentor',   warmth:0.70, push:0.30, structure:0.55, disclosure:0.90, nostalgia:0.35, owns:'head'    },
  { id:'ANANYA', arc:'mentor',   warmth:0.35, push:0.55, structure:0.90, disclosure:0.40, nostalgia:0.20, owns:'money'   },
  { id:'VEER',   arc:'mentor',   warmth:0.20, push:0.95, structure:0.85, disclosure:0.30, nostalgia:0.10, owns:'health'  },
  { id:'PRIYA',  arc:'friend',   warmth:0.90, push:0.40, structure:0.20, disclosure:0.70, nostalgia:0.25, owns:'notgood' },
  { id:'ANAY',   arc:'friend',   warmth:0.75, push:0.20, structure:0.25, disclosure:0.50, nostalgia:0.95, owns:'change'  },
];

const WEIGHTS = { warmth:1.30, push:1.25, structure:1.00, disclosure:0.85, nostalgia:0.70 };
```

> The core formerly called `ROHAN` is now `ANAY`. It collided with template M08 Rohan Oraon. If you find the old token anywhere, it is stale.

### 6.2 Answer to axis mapping

```js
Q5 disclosure → [0.10, 0.40, 0.70, 0.95][stopIndex]
Q6 warmth     → 1 - sliderPosition      // left pole = feeling understood = 1.0
Q7 push       → sliderPosition          // right pole = won't let it go = 1.0
Q8 structure  → [0.10, 0.38, 0.68, 0.95][stopIndex]
Q9 nostalgia  → 1 - sliderPosition      // left pole = miss how things were = 1.0
Q10 pressure  → ['money','health','head','alone','notgood','change'][stopIndex]
Q11 interests → array of 0..3 tag strings, DOES NOT feed the core
```

Sliders report `0..1` where `0` is the left edge.

### 6.3 Scoring

```js
function scoreCores(a) {
  const u = { warmth:a.q6, push:a.q7, structure:a.q8, disclosure:a.q5, nostalgia:a.q9 };
  const AXES = Object.keys(WEIGHTS);
  const maxD = Math.sqrt(AXES.reduce((s,k) => s + WEIGHTS[k], 0));

  return CORES.map(c => {
    const d = Math.sqrt(AXES.reduce((s,k) => s + WEIGHTS[k] * (u[k] - c[k]) ** 2, 0));
    let score = 1 - d / maxD;
    if (c.owns === a.q10) score *= 1.15;
    return { id: c.id, score: +score.toFixed(4) };
  }).sort((x, y) => y.score - x.score);
}

function assignCore(ranked) {
  const [first, second, third] = ranked;
  if (first.score - second.score >= 0.06) {
    return { primary: first.id, secondary: null, weight: 100 };
  }
  const support = second.id === 'KIAAN' ? third : second;   // Romantic never supports
  return { primary: first.id, secondary: support.id, weight: 70 };
}
```

Store the full `ranked` array in state. It is not shown, but it must be inspectable via §11.

---

## 7. The deck engine

### 7.1 Composition and ordering

Gender preference is the **only** filter. It selects F01 to F16 or M01 to M16. Everything else reorders.

```js
function orderDeck(templates, user) {
  return templates
    .map(t => ({ t, a:
        (t.region === user.region        ? 0.35 : 0) +
        (Math.abs(t.age - user.age) <= 4 ? 0.25 : 0) +
        (Math.abs(t.age - user.age) <= 8 ? 0.10 : 0) +
        overlap(t.interests, user.interests) * 0.30 +
        Math.random() * 0.12
    }))
    .sort((x, y) => y.a - x.a)
    .map(x => x.t);
}

function overlap(tags, picks) {
  if (!picks || !picks.length) return 0;
  return picks.filter(p => tags.includes(p)).length / picks.length;
}
```

The `Math.random()` term is load-bearing. Without it two users with identical answers see identical decks in identical order, which makes the machinery visible. Do not remove it "for determinism". The core must be deterministic; the deck must not be.

### 7.2 Dwell

```
dwellMs   accumulates while the card is topmost AND document.visibilityState === 'visible'
expand    adds a flat 2500ms
liked     required for eligibility, contributes no weight itself
cap       15000ms per card
```

Use `requestAnimationFrame` or a single interval. Pause on `visibilitychange`.

### 7.3 Proposal

```js
function propose(pool, dwell) {
  if (!pool.length) return null;
  const w = pool.map(id => Math.pow(Math.min(dwell[id] ?? 0, 15000) + 500, 0.7));
  const total = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) if ((r -= w[i]) <= 0) return pool[i];
  return pool[pool.length - 1];
}
```

### 7.4 Redraw states

| Liked count | Behaviour |
|---|---|
| 2 or more | Propose one. `Show me someone else` removes it from the pool and redraws |
| exactly 1 | Propose them. `Show me someone else` is **not rendered** |
| 0 | Propose highest-dwell across all 16. Secondary button allows 3 redraws down the dwell ranking, then disappears |
| pool empty | Propose highest-dwell from the original liked set. Only `Lock them in` remains |

No path through the deck may lock without an explicit user tap. Assert this in the tests.

---

## 8. Screen implementation notes

### 8.1 Splash
Six random portraits cross-fading at 2.4s intervals behind the wordmark, at 0.14 opacity. Wordmark is text set in Instrument Serif, not an image. `prefers-reduced-motion` freezes it on one image.

### 8.2 Consent
Two checkboxes, both unchecked at load. Required one gates the Continue button's `disabled` state. Record `consentAt` timestamp on continue.

### 8.3 Location
Text input with type-ahead over a hardcoded list of ~60 Indian cities plus ~40 countries. Eight suggestion chips below: Mumbai, Delhi, Bengaluru, Kolkata, Chennai, Pune, Hyderabad, Somewhere else.

Resolve to a region:
```js
North: Delhi, Noida, Gurgaon, Chandigarh, Jaipur, Lucknow, Srinagar, Amritsar, Dehradun
West: Mumbai, Pune, Ahmedabad, Surat, Nagpur, Nashik, Panaji, Rajkot, Vadodara
East: Kolkata, Bhubaneswar, Patna, Ranchi, Guwahati*, Jamshedpur, Cuttack, Siliguri
Northeast: Shillong, Aizawl, Imphal, Gangtok, Itanagar, Kohima, Agartala
Central: Bhopal, Indore, Raipur, Jabalpur, Gwalior, Ujjain
South: Bengaluru, Chennai, Hyderabad, Kochi, Coimbatore, Mysuru, Madurai, Thiruvananthapuram, Vizag, Chikmagalur, Varkala
Outside India: everything else
Unspecified: "Somewhere else" or unresolved free text
```
\*Guwahati is East here to match the casting sheet's own regional split. Do not second-guess it.

**Never request geolocation permission.**

### 8.4 Gender
Two stacked full-bleed panels, each cross-fading four portraits of that gender. A draggable selector moves between them. Commits on release with haptic `[12,40,12]`. Keyboard: arrow keys move, Enter commits.

### 8.5 Birthday
Three drag drums: day, month, year. Year opens at 2002. Haptic 8ms per detent. Compute age at today's date.

**Under 18:**
1. Discard the entered DOB from state immediately.
2. Write `ally_blocked_until` to localStorage, now + 180 days.
3. Render the blocked screen. No back button, no retry field, no link out.
4. On boot, if `ally_blocked_until` is in the future, jump straight to the blocked screen.

No red, no error icon, no exclamation mark. A closed door, not a scolding.

### 8.6 Slider and dial questions

Three interaction types, all drag-driven. **None of these is a list of tappable buttons.**

- **Four-stop slider** (Q5, Q8): detented track, thumb snaps to the nearest stop on release, haptic 8ms per stop crossed, active stop label at full opacity and the rest at 0.45.
- **Continuous slider** (Q6, Q7, Q9): free thumb, no snap, both pole labels always visible, track fills from the centre outward toward whichever pole is closer.
- **Radial dial** (Q10): six detents around ~240 degrees. Thumb dragged along the arc. Selected label sits in the centre of the dial. Haptic per detent.
- **Tile grid** (Q11): 2 columns x 4 rows. Tap toggles. At three selected, unselected tiles drop to 0.4 opacity but remain tappable; tapping one shows a brief shake and does nothing.

Progress indicator across Q5 to Q11: a thin 1px rule that fills left to right. No numbers, no dots, no "3 of 7".

### 8.7 Matching moment
2500ms exactly, not skippable. Fragments of the user's own answers surface at low opacity and dissolve. Then resolve to the copy in §5.

Forbidden on this screen: progress bars, percentages, the words analysing, calculating, thinking, processing, matching, and any scanning or radar animation.

Under `prefers-reduced-motion`: hold a static frame for 2500ms, then resolve.

### 8.8 Deck
Full-bleed card stack, treatment **C, Bleed**. See §9.2.

- Swipe right = like, left = pass, up = expand.
- Drag tracks the finger 1:1, rotation capped at 8 degrees, no spring overshoot on release.
- Threshold to commit: 32% of card width, or velocity above 0.4 px/ms.
- Undo restores the last card regardless of direction.
- Card face carries exactly four things: name (first name only), age, city, one line of occupation. Nothing else. No tags, no badges, no percentages.
- Expanded state adds the `read` line from the manifest and a collapse affordance.
- Position counter at the top. No hard stop; a user who wants to see all 16 again may.
- `Done` appears after the fourth card.
- Keyboard: left and right arrows pass and like, up expands, Z undoes.

### 8.9 Proposal
Still frame first, then autoplay the video **muted, once**. Unmute is one tap and the state persists in localStorage for subsequent plays.

Fallback chain: video fails or takes over 3s to reach `canplay` → hold the still with a slow Ken Burns drift. **The flow never blocks on video.**

### 8.10 Reveal
9:16 reveal asset full screen. Video plays through once with **sound on by default**, mute control present from the first frame. Name in Instrument Serif at the largest size in the product, ~54px. One line beneath in the persona's voice.

From this screen onward the persona's `palette` hex is the interface accent: send button, active states, chat bubble tint, focus rings.

### 8.11 Chat
Standard chat surface, tinted. The opening line is already present, generated from a template that must include the user's name and one reference to their Q10 pressure answer. Six templates per core, selected by pressure. Write these; they are the only generated copy in the build.

User's first reply sends. One canned reply comes back after a 1200 to 1800ms typing indicator. That is the full extent of the conversation engine in this build.

### 8.12 Account
Sheet over the chat, chat visible behind. Phone or email, one field, six-digit OTP field. **Format validation only. No network call. Any six digits pass.**

Dismissible once. Returns after the third exchange. Blocks at the seventh. Since this build only supports one exchange, wire the counter but expect only the first state to be reachable.

---

## 9. Design system

### 9.1 Tokens

```css
--ink:#0A0910; --surf:#151220; --raised:#1D1929; --line:#2C2638;
--fg:#F4EFE6;  --mut:#9A92A6;  --dim:#6F6880;
--k: /* the locked persona's palette hex, set on :root after lock */
```

The base carries a violet cast. It is not neutral grey and must not be "corrected" to `#111`.

Before lock: base only. After lock: `--k` drives accent, send button, active states, focus rings, reveal scrim.

### 9.2 Card treatment C, Bleed

```css
.card       { box-shadow: 0 0 0 1px color-mix(in srgb, var(--k) 45%, transparent),
                          0 22px 46px -26px var(--k);
              border-radius: 26px; overflow: hidden; position: relative; }
.card .ph   { aspect-ratio: 3/4; }
.card .ph::after {
  content:""; position:absolute; inset:0;
  background: linear-gradient(to top,
    var(--k) 0%,
    color-mix(in srgb, var(--k) 72%, transparent) 26%,
    transparent 62%);
}
.card .info { position:absolute; left:0; right:0; bottom:0; padding:0 20px 20px; }
```

Type sits directly on the portrait, lifted by a scrim in **that card's own** palette hex. Each card sets its own `--k`.

### 9.3 Type

```
Instrument Serif  400   persona names 30px on cards / 54px on reveal, letter-spacing -0.015em
Instrument Serif  400   question copy 30 to 34px
Instrument Sans   400/500  interface and body 17px, line-height 1.55
Instrument Sans   400   metadata 15.5px minimum, never below
```

Questions are set in the serif. A question in a serif reads as being asked by someone; the same question in a geometric sans reads as a form.

### 9.4 Loading

- Preload the first four deck images during Q5 to Q11.
- Load the remaining twelve during the matching moment and the first cards.
- A card that has not loaded shows **its palette hex as a solid field**. Not grey, not a skeleton, not a shimmer. A block of colour reads as intentional; a skeleton reads as broken.
- Preload the locked persona's video during the confirm sheet.
- **No spinner anywhere in the flow.**

### 9.5 Motion

One orchestrated moment: the reveal. Everything else responds to touch.

- Screen transitions: 240ms horizontal slide plus fade.
- No entrance animations on individual elements.
- `prefers-reduced-motion` removes the splash cross-fade, the matching animation and card rotation. It does **not** remove the reveal video, which is content.

### 9.6 Haptics

```js
detent      8
selection   [12, 40, 12]
liked       18
passed      none              // passing should feel weightless
lock        [20, 60, 20, 60, 40]
```

`navigator.vibrate` where available. Silent no-op elsewhere. Never show a message about haptics not being supported.

### 9.7 Sound

Four cues: detent tick, selection, lock, reveal sting. All under 400ms except the reveal. Generate with the Web Audio API; do not ship audio files. Mute control on the splash, state persists. **Sound is on by default.** This is deliberate: the reveal is materially weaker silent.

---

## 10. State and persistence

```js
state = {
  screen: 0,
  consentAt: null, consentMarketing: false,
  cityRaw: '', region: null, deckGender: null,
  displayName: '', dob: null, age: null,
  answers: { q5:null, q6:null, q7:null, q8:null, q9:null, q10:null, q11:[] },
  core: { primary:null, secondary:null, weight:null, ranked:[] },
  deckOrder: [], dwell: {}, liked: [], expanded: [],
  proposed: null, proposalsSeen: 0,
  locked: null, soundOn: true, unmuted: false,
}
```

- Persist to `localStorage` under `ally_session` on every screen transition.
- On boot: within 7 days, resume silently at `state.screen`. Between 7 and 30 days, offer continue or start over. Beyond 30 days, discard silently.
- Never show a resume modal for the under-7-day case. The user just lands where they left.

### 10.1 Recompute on back navigation

| Changed | Invalidates |
|---|---|
| Q1 location | deck order |
| Q2 gender | deck order, dwell, liked, proposed, all deck state |
| Q3 name | nothing |
| Q4 birthday | deck order. Re-runs the age gate |
| Q5 to Q10 | core assignment |
| Q11 interests | deck order |

Show the recompute toast from §5 once, at the moment it happens. Never ask the user to confirm.

---

## 11. Debug panel

Triple-tap the top-left corner to toggle. Not reachable by accident, no visible affordance.

Shows: current screen index, all raw answers, the computed user vector, **all six ranked core scores**, the assigned primary and secondary and weight, deck order, per-card dwell in ms, liked set, and `proposalsSeen`.

Two actions: `Reset session` (clears localStorage and reloads) and `Copy state as JSON`.

This panel is how the matching engine gets validated. Build it early, not last.

---

## 12. Tests

Plain `.test.js` files runnable with `node --test`. Extract the pure functions into a `<script type="module">` block or a small companion module so they are importable. No test framework beyond the node built-in.

**Matching**
1. Identical answers produce an identical core across 100 runs.
2. Every one of the six cores is reachable by some answer combination.
3. A user whose vector exactly matches a core's vector scores that core first.
4. The pressure boost is exactly 1.15x and applies to exactly one core.
5. When the top-two gap is below 0.06, a blend is produced with weight 70.
6. When the top-two gap is 0.06 or above, `secondary` is null and weight is 100.
7. KIAAN is never returned as `secondary`, across a 10,000-run sweep of random answer vectors.
8. Q11 interests do not change the assigned core. Same q5 to q10, all interest permutations, one core.

**Deck**
9. `orderDeck` always returns exactly 16 templates, all of the selected gender, no duplicates, no omissions.
10. Over 500 runs with identical input, at least two distinct orderings appear.
11. `overlap` returns 0 for an empty pick array and 1 when every pick is matched.
12. `propose` only ever returns a member of the pool.
13. `propose` never returns null when the pool is non-empty.
14. Over 5,000 runs, a card with 12,000ms dwell is proposed more often than one with 2,000ms, and the 2,000ms card is still proposed at least once.
15. Dwell above 15,000ms is capped.

**Gate**
16. DOB exactly 18 years ago today passes. One day later fails.
17. Failing the gate leaves no DOB in the persisted state.
18. A future `ally_blocked_until` short-circuits to the blocked screen on boot.

**Flow**
19. No code path sets `state.locked` without an explicit confirm action.
20. Changing Q2 clears liked, dwell and proposed.

---

## 13. Acceptance

The build is done when all of these are true:

- [ ] Runs from a local static server with no console errors and no failed requests.
- [ ] All 32 records load from `manifest.json`. No template data is hardcoded except `CORES`.
- [ ] All 20 tests pass.
- [ ] Every string in §5 appears verbatim.
- [ ] Nothing below 15.5px renders anywhere.
- [ ] The debug panel shows all six core scores.
- [ ] The full flow completes on a 390px viewport with touch, and on desktop with keyboard only.
- [ ] `prefers-reduced-motion` completes the flow with no motion except the reveal video.
- [ ] No spinner appears at any point.
- [ ] No core name is visible in any user-facing string. Grep the output for `KIAAN`, `MEHER`, `ANANYA`, `VEER`, `PRIYA`, `ANAY` and confirm every hit is inside a script block.
- [ ] Under-18 path terminates with no route forward.
- [ ] Locking is impossible without an explicit tap on `Yes, it's them`.

---

## 14. Report back

When the build passes, report:

1. Final line count and gzipped size of `ally-onboarding.html`.
2. Test output, all 20.
3. Core distribution across 1,000 random answer vectors, as a six-row table. Flag any core below 5% or above 40%.
4. Anything in this spec you had to interpret, and what you chose. **List these even if they seem trivial.** Do not silently resolve ambiguity.
5. Anything you think is wrong with the spec. Say it plainly.

Do not `git add`, `git commit` or `git push`. Stop and wait.
