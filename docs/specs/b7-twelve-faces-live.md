# B7: the remaining twelve faces live, all 32 open to everyone, and decks that never show a mock-reply face

## Context and goal

Production (`7Spidy/ally`, main) runs 20 personas: F01 to F05, F07 to F09, F11, F13 and M01 to M10. Only F01 is live for everyone; the other 19 are live for `admin` and `qa` accounts only. Twelve faces from casting sheet V7 have no persona yet, so a CUG tester who picks one gets mock replies (`replyFor`). This build:

1. Adds the twelve approved persona files, verbatim.
2. Sets all 32 faces to live for everyone (`LIVE_TEMPLATES` audience `"all"`, and the SQL mirror).
3. Adds timezone support so the six faces who live outside India read their own local time (approved: option A).
4. Removes every path that ends in a mock reply. A deck now shows only faces whose primary core is the user's matched core, the core stored on a companion is always its face's own core, and existing mismatched companions are corrected. A user who matches Money sees only the Money faces.

All five brains already exist in `src/personas/cores/index.ts`. No new brain, no new table, no change to the output contract, product rules or safety code.

| Face | Name | Primary | Secondary | Zone |
|---|---|---|---|---|
| F06 | Kavya Rane | ROMANTIC | TRAINER | India (IST) |
| F10 | Shreya Tiwari | ROMANTIC | TRAINER | India (IST) |
| F12 | Ann Mariya Joseph | FRIEND | none | India (IST) |
| F14 | Yuki Nakamura | ROMANTIC | none | Asia/Tokyo |
| F15 | Bea Villanueva | ROMANTIC | PSYCH | Asia/Manila |
| F16 | Luana Ferreira | ROMANTIC | MONEY | America/Sao_Paulo |
| M11 | Karthik Subramanian | PSYCH | none | India (IST) |
| M12 | Nikhil Menon | ROMANTIC | TRAINER | India (IST) |
| M13 | Pranav Hegde | PSYCH | none | India (IST) |
| M14 | Han Jae-won | ROMANTIC | none | Asia/Seoul |
| M15 | Chidi Okonkwo | FRIEND | TRAINER | Africa/Lagos |
| M16 | Matteo Bandini | ROMANTIC | none | Europe/Rome |

IDs, cores and palettes already match `CORE_MAP` in `src/lib/coreMap.ts` (it already lists F06 to M16). Do not edit those entries; step 4b only changes how the map is used.

## Decisions already made (do not revisit)

- The persona JSON in the appendix is approved text. Never edit it, never reformat it, never add fields.
- All 32 faces are live for everyone. The audience value is `"all"` for every face.
- Option A for time: an optional `engine.tz` (IANA zone). A face without it lives on IST, exactly as today.
- L6 is openly romantic and sensual for every core and cuts away at any described act (unchanged).
- The live rule is unchanged: a companion is live only when its own `core.primary` equals the face's primary core in `CORE_MAP` (`brainOf`). Do not change `isLive`, `is_live()` or the matching rule. The fix is that no mismatch can be created, not that mismatches become live.
- A deck holds only faces whose PRIMARY core equals the user's core. A face's secondary core never admits it to a deck. `DECK_HIDDEN` and `castsAs` are removed (the hiding of F01 from Money decks and F02 from Psych decks is now automatic, because neither is a primary Money or Psych face).
- Deck sizes follow from the map and are small for non-Romantic cores. Women: Romantic 9 (F01, F02, F03, F05, F06, F10, F14, F15, F16), Psych 2 (F04, F07), Money 2 (F11, F13), Trainer 1 (F08), Friend 2 (F09, F12). Men: Romantic 9 (M01 to M05, M07, M12, M14, M16), Psych 2 (M11, M13), Money 1 (M06), Trainer 2 (M08, M09), Friend 2 (M10, M15). They were 3 to 5 before. The deck screen already works for any size (it uses the real count and has single, no-likes and exhausted modes), so no deck UI change.
- When a user's own core deck is used up (every face in it is active or parted), the deck falls to the next ranked core, as today. In that case the companion's stored core is set to the picked face's own core, so it is live.
- The consent version string is unchanged. Do not re-prompt users.

## Rules for this build

- Do not read the appendix into context. Extract it with the script in step 1.
- The existing 20 faces must not change by a single byte of compiled prompt. Take regression snapshots before any edit (step 0) and keep them byte-identical.
- Land the code first, then the migration. With only the migration, a user could go live with a face `personaFor()` does not know yet.
- Never edit any existing `F0x.persona.json` or `M0x.persona.json`.
- Do not commit or push. Stop after the checks and wait for the owner's confirmation.

## Scope

Create: `src/personas/F06, F10, F12, F14, F15, F16, M11, M12, M13, M14, M15, M16 .persona.json`, `src/lib/presenceTz.ts`, `supabase/migrations/20261102000001_twelve_faces_live.sql`, `docs/sql/20261102000001_twelve_faces_live.editor.sql`, `tests/unit/twelveFaces.test.ts`, `tests/unit/__snapshots__/existing-prompts-before.json`, `docs/specs/b7-twelve-faces-live.md` (this spec without the appendix).

Modify: `src/personas/registry.ts`, `src/personas/persona.ts`, `src/lib/heart.ts`, `src/lib/clock.ts`, `src/lib/coreMap.ts`, `src/lib/engine.ts`, `app/onboarding/reveal/page.tsx`, `src/debug/DebugPanel.tsx`, `src/components/ChatHeader.tsx`, `src/components/CompanionCard.tsx`, and the existing tests whose lists change (`personas.test.ts`, `eightFaces.test.ts`, `tenMen.test.ts`, `fiveCores.test.ts`, and the RLS tests listed in step 7). Also create `tests/unit/deckLive.test.ts`.

Do not touch: the `CORE_MAP` entries themselves, `PRESENCE` in `copy.ts` (it already has all 32 faces), `firstRun/order.ts`, manifests, portraits, lint rules, `compile.ts`, `cores/`, any safety or ledger code.

## Reference patch

`build-reference.patch` (placed next to this file) is a working, verified version of steps 2 to 6 (including 4b and the backfill), and of the unit-test parts of step 7 except the `existing-prompts-before.json` regression gate, against `main`: it applies cleanly with `patch -p1` or `git apply`, and with it all 1,174 unit tests and `tsc` pass. It excludes the persona files (they come from the appendix). You may start from it, but the steps below govern: if the patch and a step disagree, follow the step, and tell the owner.

## Steps

### 0. Baseline before any edit

1. `git pull`. Run the full unit suite, `tsc --noEmit` and the linter. They must pass before you start. Note anything already failing (on `main` the linter reports four `no-require-imports` errors in `tests/unit/engine.test.ts`; that is existing, leave it).
2. Using the same helpers as `promptSnapshot` in `tests/unit/iraSnapshotFixture`, write `tests/unit/__snapshots__/existing-prompts-before.json` with the compiled `system` and `volatile` for each of the 20 existing faces (F01 to F05, F07 to F09, F11, F13, M01 to M10) at L1, L3, L5 and L6, at a fixed clock. It is generated from the current code and is the regression gate. After step 5 a test must assert the compiled output for all 20 equals it, byte for byte.

### 1. Persona files

Run this from the repo root. It writes the twelve files byte for byte and checks each sha256:

```bash
python3 - <<'PY'
import re, hashlib, pathlib
t = pathlib.Path("claude_change_spec.md").read_text(encoding="utf-8")
pat = re.compile(r"<!-- BEGIN FILE: (\S+) sha256=([0-9a-f]{64}) -->\n```json\n(.*?)\n```\n<!-- END FILE -->", re.S)
found = pat.findall(t)
assert len(found) == 12, len(found)
for path, sha, body in found:
    data = (body + "\n").encode("utf-8")
    assert hashlib.sha256(data).hexdigest() == sha, path
    pathlib.Path(path).write_bytes(data)
    print("wrote", path)
PY
```

### 2. Timezone: type and clock (src/personas/persona.ts, src/lib/heart.ts)

1. In `PersonaEngine` add `tz?: string;` after `city`, with a comment: an IANA zone; absent means Asia/Kolkata.
2. In `heart.ts` add two exports beside `istNow`, keeping `istNow` as is:
   - `zonedNow(ms, tz): IstParts` builds the same shape as `istNow` from `Intl.DateTimeFormat("en-GB", { timeZone: tz, year, month, day, hour, minute: "numeric", hourCycle: "h23" }).formatToParts`. The weekday comes from `new Date(Date.UTC(year, month - 1, dom)).getUTCDay()`. `dayKey` is `YYYY-MM-DD`.
   - `localNow(ms, persona): IstParts` returns `zonedNow(ms, persona.engine.tz)` when `tz` is set and `istNow(ms)` otherwise.
3. In `heart.now()` replace both `istNow(...)` calls (`ist` and `created`) with `localNow(..., persona)`. Nothing else in `heart.ts` changes: `timeBlock`, `moodFor`, `seasonFor` and `clockLine` already take the parts they are given, so they now read the face's own clock, weekday, month and date.
4. Do not touch `istNow` callers elsewhere: `safety.ts` (`endOfIstDay`) and the ledger are about the user's day and stay on IST.

### 3. Milestones for faces outside India (src/lib/heart.ts)

In `milestoneFor`, compute `const indian = !args.persona.engine.tz || args.persona.engine.tz === "Asia/Kolkata";` and require `indian` for the Diwali milestone and for the first-of-July rain milestone only. The level 6, birthday, anniversary and 100-message milestones stay for everyone. The birthday uses the face's own local date, which is correct because `app/api/chat/reply/route.ts` passes `h.ist` from `heart.now`.

### 4. Presence line in the header and home card

`PRESENCE` is a static day or night line chosen by the IST hour, which would be wrong for the six zoned faces.

1. `src/lib/clock.ts`: add `isDaytimeIn(ms, tz = "Asia/Kolkata")` (07:00 to 19:59 on that zone's wall clock) and make `isDaytimeIST(ms)` call it.
2. New `src/lib/presenceTz.ts` exporting `PERSONA_TZ: Record<string, string>` with exactly: F14 Asia/Tokyo, F15 Asia/Manila, F16 America/Sao_Paulo, M14 Asia/Seoul, M15 Africa/Lagos, M16 Europe/Rome. The client must not import persona files (they are large), hence this small copy; a test (step 6) ties it to `engine.tz`.
3. `ChatHeader.tsx` and `CompanionCard.tsx`: use `isDaytimeIn(now(), PERSONA_TZ[template.id])` in place of `isDaytimeIST(now())`.

### 4b. Decks show only faces that are live for the user's core

This is what stops mock replies for a user whose core differs from a face's primary core.

1. `src/lib/coreMap.ts`: replace `castsAs` and `DECK_HIDDEN` with `servesCore(id, core): boolean`, true only when `CORE_MAP[id][0] === core` (false for unknown ids). Update the file comment: a face belongs to a core's deck only through its primary core; the secondary is texture. Leave every `CORE_MAP` entry as is.
2. `src/lib/engine.ts`: in `deckTemplates` replace `castsAs(t.id, core) && !DECK_HIDDEN[t.id]?.includes(core)` with `servesCore(t.id, core)`, and fix the doc comments of `deckTemplates` and `buildCoreDeck` (every face is the primary of exactly one core). `buildCoreDeck`'s fallback to the next ranked core stays.
3. `src/lib/engine.ts`: add and export `coreForFace(core: Core, templateId: string): Core`. If the id is unknown or `core.primary` already equals the face's primary core, return `core` unchanged (same object). Otherwise return `{ ...core, primary: face primary, secondary: face secondary, weight: face secondary ? 70 : 100 }`, keeping `ranked`.
4. `app/onboarding/reveal/page.tsx`: pass `core: coreForFace(flow.core, flow.proposed)` to `createCompanion` (import it from `@/lib/engine`). `src/debug/DebugPanel.tsx`: wrap the seeded core the same way (`coreForFace(computeCore(answers), t.id)`).
5. Check every other `createCompanion(` and `create_companion` caller. As of `main` only those two exist. Any new caller must align the core the same way.
6. Nothing else in onboarding changes: matching, the questions, the swipe deck, the proposal, the Constellation and the reveal all take the deck from `deckFor`/`buildCoreDeck`. The Android app loads `https://ally.redream.in` (`capacitor.config.ts`, `server.url`), so the Play Store CUG build gets this on deploy with no new app release.

### 5. Registry and live audience (src/personas/registry.ts)

1. Import the twelve files and export `F06, F10, F12, F14, F15, F16, M11 to M16: Persona` the same way as the others.
2. `PERSONAS` holds all 32 ids.
3. `LIVE_TEMPLATES` lists all 32 ids, every value `"all"`.
4. `brainOf` already works from `CORE_MAP`. `QaSheet`, `vault.ts` and `live.ts` read `LIVE_TEMPLATES` and `PERSONAS`, so they pick the new faces up with no change; confirm that.

### 6. Migration

New migration `20261102000001_twelve_faces_live.sql` and the SQL-editor copy `docs/sql/20261102000001_twelve_faces_live.editor.sql` (same header, `begin; ... commit;` wrapper and migration-record statement as `20261101000001_ten_men_live.editor.sql`). It only replaces `ally_private.live_faces()`. `is_live()` and `qa_add_companion()` need no change (`qa_add_companion` reads the same rows and stays qa-only). Do not alter any table. The migration has two parts: the new `live_faces()` rows, and a backfill that corrects existing companions (below). The function body is:

```sql
values
    ('F01', 'ROMANTIC', 'MONEY', 'all'),
    ('F02', 'ROMANTIC', 'PSYCH', 'all'),
    ('F03', 'ROMANTIC', 'TRAINER', 'all'),
    ('F04', 'PSYCH', null, 'all'),
    ('F05', 'ROMANTIC', 'FRIEND', 'all'),
    ('F06', 'ROMANTIC', 'TRAINER', 'all'),
    ('F07', 'PSYCH', null, 'all'),
    ('F08', 'TRAINER', null, 'all'),
    ('F09', 'FRIEND', null, 'all'),
    ('F10', 'ROMANTIC', 'TRAINER', 'all'),
    ('F11', 'MONEY', null, 'all'),
    ('F12', 'FRIEND', null, 'all'),
    ('F13', 'MONEY', 'FRIEND', 'all'),
    ('F14', 'ROMANTIC', null, 'all'),
    ('F15', 'ROMANTIC', 'PSYCH', 'all'),
    ('F16', 'ROMANTIC', 'MONEY', 'all'),
    ('M01', 'ROMANTIC', 'MONEY', 'all'),
    ('M02', 'ROMANTIC', 'MONEY', 'all'),
    ('M03', 'ROMANTIC', 'FRIEND', 'all'),
    ('M04', 'ROMANTIC', 'PSYCH', 'all'),
    ('M05', 'ROMANTIC', 'MONEY', 'all'),
    ('M06', 'MONEY', null, 'all'),
    ('M07', 'ROMANTIC', 'FRIEND', 'all'),
    ('M08', 'TRAINER', null, 'all'),
    ('M09', 'TRAINER', 'PSYCH', 'all'),
    ('M10', 'FRIEND', null, 'all'),
    ('M11', 'PSYCH', null, 'all'),
    ('M12', 'ROMANTIC', 'TRAINER', 'all'),
    ('M13', 'PSYCH', null, 'all'),
    ('M14', 'ROMANTIC', null, 'all'),
    ('M15', 'FRIEND', 'TRAINER', 'all'),
    ('M16', 'ROMANTIC', null, 'all')
```

wrapped exactly as:

```sql
create or replace function ally_private.live_faces()
returns table (template_id text, primary_core text, secondary_core text, audience text)
language sql immutable set search_path = '' as $$
  values
    ...32 rows as above...
$$;
revoke all on function ally_private.live_faces() from public, anon, authenticated;
```

Then the backfill, after the `revoke`, in both the migration and the SQL-editor copy (before the migration-record insert). A companion created before this build can hold a core that differs from its face's primary core, which makes `is_live()` false, so its chat is mock. Align each active one to its face, using the same shape `qa_add_companion` writes (`ranked` is kept; parted companions carry the empty core and are not touched):

```sql
update public.companions c
set core = jsonb_set(
             jsonb_set(
               jsonb_set(c.core, '{primary}', to_jsonb(f.primary_core)),
               '{secondary}', coalesce(to_jsonb(f.secondary_core), 'null'::jsonb)),
             '{weight}', to_jsonb(case when f.secondary_core is null then 100 else 70 end))
from ally_private.live_faces() f
where f.template_id = c.template_id
  and c.status = 'active'
  and (c.core->>'primary') is distinct from f.primary_core;
```

This was parsed with a Postgres parser and is syntactically valid, but it has not been run against a database. Run it on the local stack first (an RLS test below), then staging.

### 7. Tests

Unit (no Docker):

1. New `tests/unit/twelveFaces.test.ts`. Basis: the one in `build-reference.patch`. It must cover, for each of the twelve: every Persona key, table lengths of at least 7, real cards, energies and moods, 6 seasons, 12 arc beats, 7 week days, 6 levels, 10 moods, golden tiers 1, 3 and 5 with one-bubble L1 replies of at most 200 characters, ascending block times with `nightEnd` after the last start, no em or en dashes, at most one question run per golden reply and level line, no address terms (`bhai, bro, bhaiya, dada, daju, bawa, macha, bruh, dude, beta, sir, didi, sis`), every `engine.people` name introduced in a hard rule with an example, `brainOf` equals `CORE_MAP[id][0]` and the secondary text matches the map, `engine.tz` present exactly for F14, F15, F16, M14, M15, M16 and equal to `PERSONA_TZ`.
2. Compile at L1 to L6 for all twelve: `CORE (<name>)` present, the localized core rules present, no other level's line in the system prompt, the L6 line from L5 up, romantic-emoji gate (L3 for ROMANTIC, L5 for the rest), stable prefix identical across two clocks, and for the men no line outside `Family:` matches `/\b(she|her|hers|herself)\b/i`.
3. Guardrails reach the prompt: F15 contains `breath-hold`; F06 contains `never say whether any water is safe`; M12 contains `never say whether any beach, wave or water is safe`; F16 contains `never say buy, sell or hold`; M15 contains `not a lawyer`; M11 contains `trained in music therapy`; M13 contains `no longer practises`; F14 contains `text only`.
4. Zoned clock: at 04:30 UTC on 2026-05-12 (10:00 IST) the local hour is 13 (Osaka, minute 30), 13 (Seoul), 12 (Cebu), 5 (Lagos), 1 (Sao Paulo), 6 (Milan, summer); Milan in January at 04:30 UTC is 5. Sao Paulo is still Monday when IST is already Tuesday 01:30. Every face without `tz` returns exactly `istNow(t)`. F14 is `Asleep` at 01:00 JST and `Lights out` at 23:30 JST.
5. Milestones: Diwali (2026-11-08) fires for M04 and not for F14; the first-of-July rain moment fires for M04 and not for F16.
6. `isLive`: each of the twelve is live for any owner when the primary matches, and not when it does not (F06 with TRAINER, M11 with ROMANTIC, F12 with ROMANTIC).
7. Regression: the compiled output of all 20 existing faces equals `existing-prompts-before.json`.
8. New `tests/unit/deckLive.test.ts` (basis: the one in `build-reference.patch`): all 32 are listed with audience `all`; for each core and gender every face in the deck is live for that core; a Money user's decks are exactly F11 and F13 (women) and M06 (men); over 2,000 generated answer sets, genders and random used-face sets, every face `buildCoreDeck` can return is live once the core is aligned with `coreForFace`; `coreForFace` returns the same object on a match, aligns primary, secondary and weight (keeping `ranked`) on a mismatch, leaves unknown ids alone, and agrees with `CORE_MAP` for all 32.
9. Update `tests/unit/fiveCores.test.ts` for primary-only decks: `servesCore` replaces `castsAs` and `DECK_HIDDEN` in the imports and tests; first-run deck sizes are Romantic 9 and the others 1 or 2; F01 and F02 are in the Romantic deck only; every face is the primary of exactly one core (so the union of the five decks is the whole 16-face pool per gender); the fallback tests use trainer women `[F08]`, friend women `[F09, F12]`, psych women `[F04, F07]`, a fourth-ranked fallback to the nine Romantic women, and a fifth to Money's `[F11, F13]`; the parted-face test uses men (`M08` excluded leaves `[M09]`); `deckFor` for a Money-leaning user returns `[F11, F13]`.
10. Update the existing unit tests whose lists change: `personas.test.ts` (registry lists all 32 as `"all"`, 32 personas; F02, M01 and F01 are live for any owner), `eightFaces.test.ts` and `tenMen.test.ts` (each face is live for any owner with a matching primary). A mismatched primary stays not live.

RLS (needs Docker, run them yourself against the local Supabase stack and tell the owner the result):

- `tests/rls/eightFacesLive.test.ts` and `noorLive.test.ts`: `F06` is now a listed template, so `qa_add_companion` accepts it; keep `M99` and the injection string as the refused inputs and remove `F06` from the refusal lists. `qa_add_companion` stays qa-only, so "a normal user is rejected" is unchanged.
- The same files assert that a normal user's `F02` or `F04` is not live. Now the audience is `all`, so a normal user's companion is live when its primary matches the face's primary (F04 with PSYCH, F02 with ROMANTIC) and still not live with a mismatched primary. Rewrite those assertions to say that.
- Add one RLS test that `live_faces()` returns 32 rows, all with audience `all`, and that each row's primary matches `CORE_MAP`.
- Add one RLS test for the backfill: insert an active companion for a normal user whose `core.primary` differs from its face's primary (for example `F11` with ROMANTIC), confirm `is_live()` is false, run the backfill `update` statement from step 6, and confirm `is_live()` is now true, with `ranked` untouched. Also confirm a parted companion (empty core) is not changed.
- Run the rest of the RLS suite unchanged.

E2E: no new spec. Run the existing e2e suite. Specs that assume deck sizes or that a non-Romantic user sees secondary-core faces will now fail (decks for Psych, Money, Trainer and Friend users are one or two faces). Update those expectations to the sizes in the decisions section and report which ones you changed. `e27-b1-onboarding` already references F06, F10, F14, F15 and F16 in the Romantic deck.

### 8. Rollout

1. Land the code (steps 1 to 5 and the tests). Nothing changes for users yet, because the old `is_live()` still excludes the new faces and `qa`-restricts the rest.
2. Apply the migration to staging with the SQL-editor copy, then prod. Before applying to prod, run `select count(*) from public.companions c join ally_private.live_faces() f on f.template_id = c.template_id where c.status = 'active' and (c.core->>'primary') is distinct from f.primary_core;` and note the number (these are the companions the backfill fixes); after applying it must be 0.
3. Smoke-test on staging with a normal (non-qa) account: answer the questions so the core is Money, confirm the deck shows only F11 and F13 (or M06), pick one and get a live reply; do the same for a Romantic user; confirm one of the six zoned faces replies in its own local time.
4. Keep the order. Do not apply the migration before the code is deployed.

## Known behaviour that this build does not change

- Non-Romantic decks are now one or two faces (see the decisions section). That is a direct result of showing only faces that are live for the user's core, and it was approved on that basis. If it later feels thin, the real fix is more faces for those cores, not letting secondary-core faces back into decks.
- A user's 70/30 secondary core no longer adds faces to their deck. It still only matters for the persona text the engine ignores.
- If a user parts with or has used every face in their core and gender, the deck falls to the next ranked core's faces, and the stored core follows the face.
- The persona `secondaryCore` text is texture only and is not read by the engine (existing behaviour).

## Acceptance

- [ ] The twelve persona files exist and each sha256 matched.
- [ ] `existing-prompts-before.json` was generated before any edit and the final test against it passes.
- [ ] Full unit suite, `tsc --noEmit` and the linter pass (apart from the four existing lint errors noted in step 0).
- [ ] RLS suite run against local Supabase with the updates above, result reported.
- [ ] `LIVE_TEMPLATES` has 32 entries, all `"all"`; `live_faces()` has 32 rows, all `'all'`.
- [ ] No deck contains a face that is not live for that deck's core, and `castsAs` and `DECK_HIDDEN` no longer exist anywhere in the repo.
- [ ] The mismatch count query returns 0 after the migration on staging and prod.
- [ ] Nothing committed or pushed.
