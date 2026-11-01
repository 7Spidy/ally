# B6: ten men live for QA (M01 to M10)

## Context and goal

Production (`7Spidy/ally`, main) already runs Ira (F01, all users), Noor (F02) and eight women (F03, F04, F05, F07, F08, F09, F11, F13) for admin and qa accounts, with five brains (ROMANTIC, PSYCH, TRAINER, MONEY, FRIEND) in `src/personas/cores/index.ts`. Add the ten men from the casting sheet, M01 to M10, the same way: one persona JSON each, verbatim, live for `admin` and `qa` accounts only. All five brains exist, so no new brain is needed.

IDs, cores and palettes already match `src/lib/coreMap.ts` and casting sheet v6.2. Do not remap anything.

| Face | Name | Primary | Secondary |
|---|---|---|---|
| M01 | Arjun Bhalla | ROMANTIC | MONEY |
| M02 | Vikram Rathore | ROMANTIC | MONEY |
| M03 | Kabir Bhatnagar | ROMANTIC | FRIEND |
| M04 | Rehan Contractor | ROMANTIC | PSYCH |
| M05 | Omkar Joshi | ROMANTIC | MONEY |
| M06 | Jaydev Zala | MONEY | none |
| M07 | Anirban Dutta | ROMANTIC | FRIEND |
| M08 | Rohan Oraon | TRAINER | none |
| M09 | Tenzing Bhutia | TRAINER | PSYCH |
| M10 | Yash Chourasia | FRIEND | none |

Decisions already made (do not revisit): L6 is openly romantic for every face, including non-romantic brains. Live audience is `qa` for all ten. Deck visibility is unchanged (no `DECK_HIDDEN` entries). The persona JSON in the appendix is approved text: never edit it.

## Rules for this build

- Do not read the appendix into context. Extract it with the script in step 1.
- Women's behaviour must not change. Take regression snapshots before any edit (step 0) and keep them byte-identical.
- Land code first, then the migration (with only code, nothing new goes live; with only the migration, a QA owner could go live before `personaFor` knows the persona).
- Never edit any `F0x.persona.json`.

## Scope

Create: `src/personas/M01..M10.persona.json`, `src/personas/pronouns.ts`, `supabase/migrations/20261101000001_ten_men_live.sql`, `docs/sql/20261101000001_ten_men_live.editor.sql`, `tests/unit/tenMen.test.ts`, `tests/unit/__snapshots__/women-prompts-before.json`, `docs/specs/b6-ten-men-live.md` (this spec without the appendix).

Modify: `src/personas/registry.ts`, `src/personas/cores/index.ts`, `src/lib/llm/compile.ts`, `src/lib/copy.ts` (consent body only), existing tests whose counts or exact lists change (`personas.test.ts`, `eightFaces.test.ts`, `fiveCores.test.ts`, `tests/rls/eightFacesLive.test.ts`, e2e specs that assert the consent text).

Do not touch: `coreMap.ts` (already has M01 to M16), `PRESENCE` in `copy.ts` (already has M01 to M10 and matches the clocks), `firstRun/order.ts`, manifests, portraits, lint rules.

## Steps

### 0. Baseline before any edit

1. `git pull`. Run the full unit suite and typecheck; they must pass before you start. Note anything already failing.
2. Using the same helpers as `iraSnapshotFixture` / `promptSnapshot`, write `tests/unit/__snapshots__/women-prompts-before.json` with the compiled `system` and `volatile` for each of F01, F02, F03, F04, F05, F07, F08, F09, F11, F13 at L1, L3, L5 and L6, at a fixed clock. This file is the regression gate. It is generated from the current code and committed in this build.

### 1. Persona files

Run this from the repo root. It writes the ten files byte for byte and checks each sha256:

```bash
python3 - <<'PY'
import re, hashlib, pathlib
t = pathlib.Path("claude_change_spec.md").read_text(encoding="utf-8")
pat = re.compile(r"<!-- BEGIN FILE: (\S+) sha256=([0-9a-f]{64}) -->\n```json\n(.*?)\n```\n<!-- END FILE -->", re.S)
found = pat.findall(t)
assert len(found) == 10, len(found)
for path, sha, body in found:
    data = (body + "\n").encode("utf-8")
    assert hashlib.sha256(data).hexdigest() == sha, path
    pathlib.Path(path).write_bytes(data)
    print("wrote", path)
PY
```

### 2. Registry

In `src/personas/registry.ts` import the ten files, export `M01..M10: Persona`, add them to `PERSONAS`, and add them to `LIVE_TEMPLATES` with `"qa"`. `brainOf` already works from `CORE_MAP`. `QaSheet` and `vault.ts` read `LIVE_TEMPLATES`, so they pick the men up with no change; confirm that.

### 3. Pronoun layer (the one real engine change)

The shared prompt text is written in the feminine, which would make every man read "she leads as often as she follows". Fix it without changing a single byte of the women's prompts.

Exact strings affected:

- `cores/index.ts`: PSYCH warmth ("Her attention and her questions are free from day one") and rule ("She is not the user's therapist"); TRAINER warmth ("how she cares", "her own fears"); MONEY warmth ("how she cares", "her own life, her doubts"); FRIEND warmth ("her own mess, her fears"); `coreBlock` line "Initiative: she leads as often as she follows".
- `compile.ts`: `VAGUE_ARC` ("her attention"), "- Her own day: ...", "say it as her own choice".

Implementation:

1. `src/personas/pronouns.ts`: `export function pronounsFor(p: { id: string })` returns `{ sub, obj, pos, Pos, Sub }`. Ids starting with `M` give he, him, his; everything else gives she, her, her. No new field in the persona schema.
2. Turn each affected string into a template that takes the pronoun set. For F ids the rendered output must equal today's string exactly.
3. Keep exporting `CORES` as the feminine default (tests and other code import it) and add `coreDef(core, persona)` returning the localized definition. `coreBlock` and `compile` use `coreDef`.
4. Step 0's snapshot test must still pass unchanged after this step.

### 4. Migration

New migration `20261101000001_ten_men_live.sql`, plus the SQL-editor copy in `docs/sql/` with the same header and `begin; ... commit;` wrapper and the migration-record statement used by `20261026000001_eight_faces_live.editor.sql`. Mirror that file's style exactly.

1. `create or replace function ally_private.live_faces()` with the existing ten rows plus:

```
('M01','ROMANTIC','MONEY','qa'), ('M02','ROMANTIC','MONEY','qa'), ('M03','ROMANTIC','FRIEND','qa'),
('M04','ROMANTIC','PSYCH','qa'), ('M05','ROMANTIC','MONEY','qa'), ('M06','MONEY',null,'qa'),
('M07','ROMANTIC','FRIEND','qa'), ('M08','TRAINER',null,'qa'), ('M09','TRAINER','PSYCH','qa'),
('M10','FRIEND',null,'qa')
```

2. `create or replace function public.qa_add_companion(template_id text)`: copy the current body from `20261026000001_eight_faces_live.sql` and change one thing. It hard-codes `deck_gender` to `'woman'`. Use `case when left(qa_add_companion.template_id, 1) = 'M' then 'man' else 'woman' end`. Keep the revokes and grants identical.
3. `is_live` needs no change. Do not alter any table.

### 5. Consent copy

`copy.ts` `live.consentBody` currently reads "{persona} now replies live. Her replies are written by an AI model. She remembers key things you tell her so conversations carry over. You can delete everything any time in Settings." Replace with:

"{persona} now replies live. The replies are written by an AI model, and key things you tell {persona} are remembered so conversations carry over. You can delete everything any time in Settings."

Do not change the consent version string (changing it would re-prompt every live user). Update any test or e2e assertion on the old text.

### 6. Tests (`tests/unit/tenMen.test.ts`)

Reuse the structure of `eightFaces.test.ts` with `MEN = ["M01".."M10"]`. Update the existing tests whose lists are now 20 faces (registry key count, `LIVE_TEMPLATES` exact object, `NEW_IDS` loops). Add:

- Schema, table lengths of at least 7, context cards, energy entries, mood keys, 6 seasons, 12 arc months, 7 week days, 6 levels, golden tiers, ascending block times with `nightEnd` after the last start, no em or en dashes, at most one question run per golden reply and level line, every `engine.people` name in a hard rule with an introduction example.
- Core coherence: `brainOf` equals `CORE_MAP[id][0]` and the secondary string starts with the mapped secondary (or is `none`).
- Compile at L1 to L6 for all ten: `CORE (<name>)` present, localized core rules present, other levels' lines absent, L6 line present from L5 up, romantic-emoji gate (L3 for ROMANTIC, L5 for the rest), stable prefix identical across two clocks.
- Pronouns: for every man and level, no line of `system` or `volatile` matches `/\b(she|her|hers|herself)\b/i` except lines starting with `Family:`. For every woman, the compiled output equals `women-prompts-before.json`.
- Guardrails: M06 system contains "SEBI-registered"; M08 and M09 contain "no calorie, macro or weight targets"; M01, M02, M05 contain "never say buy, sell or hold" via their hard rules.
- Address terms: no golden bubble, level line, mood line, good example or playbook line matches `/\b(bhai|bro|bhaiya|dada|daju|bawa|macha|bruh|dude|beta|sir|didi|sis)\b/i` for any man (the app does not know the user's gender).
- Clocks (IST): M01 Wed 02:00 is "On the back steps" and 03:00 is "Asleep"; M01 Sat 14:00 is "Open" and 19:00 is "In service"; M03 Tue 21:00 is "In a contest"; M04 Tue 04:00 is "On the balcony" and 05:00 is "Asleep"; M07 Tue 23:00 is "In the office"; M08 Tue 22:00 is "Lights out"; M09 Tue 23:00 is "Lights out"; M10 Wed 02:00 is "After closing" and 04:00 is "Asleep".
- `isLive`: each man is live for a qa owner with a matching primary and not for a normal owner; a mismatched primary is never live (for example M01 with MONEY, M06 with ROMANTIC).
- RLS (`tests/rls/`, needs Docker, run if available, else report skipped): `qa_add_companion('M01')` as a qa user returns a companion with `deckGender` `man`; `qa_add_companion('F03')` still returns `woman`; a normal user is rejected; `qa_add_companion('M99')` raises `template_not_testable`.

### 7. Evals (not CI)

If `LLM_API_KEY`, `LLM_BASE_URL` and `LLM_MODEL` are available, run `npm run eval:persona -- --persona M0X --tag=b6` for each of the ten and commit the outputs under `docs/evals/`. Read each one and report anything flagged, any lint hits above zero, any reply that uses a gendered address term, any reply that gives a product pick, diet number, route or diagnosis. If the env is not available, skip and say so. Do not edit persona JSON to fix an eval finding; report it.

### 8. Verify, push, migrate

1. Typecheck, lint, the full unit suite, `scripts/prompt-size.ts` (the stable prefix size of the women must be unchanged).
2. If everything is green, commit and push to `main`. If anything is red, stop and report; do not push.
3. After the deploy is healthy, apply the migration: `supabase db push` to staging, verify, then production. If you cannot apply it, do not guess: report the exact commands and the path of the SQL-editor copy.
4. Verify on production with a qa account: add M01 and M08 from the QA sheet, send one message to each, confirm a live reply and that `deck_gender` is `man`.

### 9. Report back

Commit hash, test counts, snapshot result (women unchanged), eval flags, migration status for staging and production, and anything you skipped.

## Out of scope

Editing persona text, deck visibility or `DECK_HIDDEN`, portraits and videos, `PRESENCE`, the women's content (Mawii, Deepa and Zoya still use bro, macha and bawa; leave them), and lint changes (all ten men's introduced names use relationship words already in the lint list).

## Known behaviour, unchanged

A user whose own core matches only a man's secondary core (for example a MONEY user who picks M01) gets the mocked chat, because `isLive` needs the companion's primary core to equal the face's primary. This is how F03, F05 and F13 behave today. QA accounts bypass it through `qa_add_companion`.

The persona JSON appendix is omitted here; the approved text lives in `src/personas/M01..M10.persona.json`.
