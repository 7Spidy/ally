# claude_change_spec.md: New plan tiers (T2)

Base: GitHub `main` at `13a4c1b` (15 Nov 2026, U1 UX fixes). Everything here is web-side. Do not touch `android/`, `capacitor.config.ts` or `mobile-shell/`. No APK change.

## 1. Context and goal

The plans and trial build (`20261111000001_plans_and_trial.sql`) is live in code. This build:

- changes the tier numbers (prices, Ally slots, hidden caps),
- updates the plan copy to match.

The chat model stays DeepSeek V4 Pro. Do not change `src/lib/llm/`, `LLM_MODEL` or any Vercel setting.

The trial, entitlement logic, plans screen, entry points and billing stub stay as they are. Only the values and copy change.

The visual reference is `docs/mocks/ally_plans_screen.html`. It is already built on the app's own tokens and the live `/plans` layout, so **do not change any CSS**. Only the values and copy differ from production.

## 2. New plan table (source of truth)

| | Trial | Pro | Max | Ultra |
|---|---|---|---|---|
| Price (INR a month, GST incl.) | free, 7 days | **99** (was 299) | **149** (was 499) | **249** (was 799) |
| Ally slots | 1 | 1 | **3** (was 2) | **5** (was 4) |
| Visible daily chats | 100 | unlimited | unlimited | unlimited |
| Hidden daily cap | n/a | **400** (was 300) | 400 | 400 |
| Max trust level | 5 | 5 | 5 | 6 |

Unchanged: Play product ids (`ally_pro`, `ally_max`, `ally_ultra`), base plan `monthly`, trial length, trial allowance, max levels.

## 3. Scope

The git root is the repo root. Files known to need changes:

- `supabase/migrations/`: a new migration (4.1).
- `docs/sql/`: an SQL-editor copy of that migration (4.2).
- `src/lib/config.ts`: `PLAN_CONFIG.tiers`, `HIDDEN_DAILY_CAPS`.
- `src/lib/copy.ts`: `COPY.plans.pro|max|ultra`, `COPY.home.capCardTitle`, `COPY.home.capCardBody`.
- Tests that pin the old values:
  - `tests/unit/sqlConstants.test.ts`, `copy.test.ts`, `billing.test.ts`, `plans.test.ts`
  - `tests/e2e/e4-slot4-cap.spec.ts`, `e31-plans.spec.ts`
  - `tests/rls/plans.test.ts`, and any other RLS or e2e test that asserts 2 or 4 slots, 300 as a cap, or 299/499/799.

Grep the repo for each old value: `299`, `499`, `799`, `slots: 2`, `slots: 4`, `300`, `"four"`, `Four Allys`. Fix every hit that refers to plans, and leave unrelated hits alone. List every file you changed in your summary.

## 4. Steps

### 4.1 Migration

Create `supabase/migrations/20261115000002_new_tiers.sql`. It contains **only** `create or replace function` statements for these constants, keeping the exact signatures from `20261111000001_plans_and_trial.sql`:

```sql
create or replace function ally_private.slots_max()   returns int language sql immutable set search_path = '' as $$ select 3 $$;
create or replace function ally_private.slots_ultra() returns int language sql immutable set search_path = '' as $$ select 5 $$;
create or replace function ally_private.cap_pro()     returns int language sql immutable set search_path = '' as $$ select 400 $$;
create or replace function ally_private.price_pro()   returns int language sql immutable set search_path = '' as $$ select 99 $$;
create or replace function ally_private.price_max()   returns int language sql immutable set search_path = '' as $$ select 149 $$;
create or replace function ally_private.price_ultra() returns int language sql immutable set search_path = '' as $$ select 249 $$;
```

Add a header comment explaining what changed and why: the new tiers, and that `slot_limit_for`, `daily_cap_for` and `companion_locked` read these functions, so nothing else needs replacing.

Check that `create or replace` keeps the existing grants on these functions. If any function in `ally_private` had an explicit grant or revoke in the original migration, repeat it.

No data changes are needed:
- A user on Max or Ultra simply gains slots.
- Nobody loses slots, so no companion becomes newly locked.

**This migration is already applied to both staging and prod** (15 Nov 2026, via the Supabase SQL editor). Both runs were verified to return `3, 5, 400, 99, 149, 249`, and `20261115000002 / new_tiers` is recorded in `supabase_migrations.schema_migrations` on both. Your file must therefore use exactly this version and name, and exactly the six statements above, so the repo matches what is live.

### 4.2 SQL-editor copy

Follow the existing convention in `docs/sql/`:
- Create `docs/sql/20261115000002_new_tiers.editor.sql`.
- Use the same header wording as the other `.editor.sql` files.
- Wrap the migration body in `begin; ... commit;`.
- Make the last statement inside the transaction record the migration in `supabase_migrations.schema_migrations`, exactly as the existing editor files do, so a later `supabase db push` skips it.

### 4.3 Config

In `src/lib/config.ts`:
- Pro becomes `price: 99`.
- Max becomes `price: 149, slots: 3`.
- Ultra becomes `price: 249, slots: 5`.
- `HIDDEN_DAILY_CAPS` becomes `{ pro: 400, max: 400, ultra: 400 }`.

`MAX_COMPANIONS` derives from Ultra's slots and becomes 5 on its own. Confirm that nothing else hard-codes 4 as the companion ceiling, including the home add card, the debug panel, the second onboarding, `merge_anonymous` callers and the admin console.

### 4.4 Copy

In `src/lib/copy.ts`, with no em dashes anywhere:

```ts
pro:   { tag: "For daily talkers",   lead: "",                  feats: ["Unlimited chats", "1 Ally", "Every level except the deepest"] },
max:   { tag: "Room for 3 Allys",    lead: "Everything in Pro", feats: ["2 more Allys, each with their own memory"] },
ultra: { tag: "The full experience", lead: "Everything in Max", feats: ["2 more Allys, 5 in all", "The deepest level with every Ally"] },
```

The home cap card becomes:
- `capCardTitle`: `"That's five"`
- `capCardBody`: `"Five Allys is the most Ally keeps at once. Part ways with one to make room for someone new."`

Leave every other plans string unchanged.

### 4.5 Mock

`docs/mocks/ally_plans_screen.html` was committed together with this spec. Use it as the reference and do not edit it.

### 4.6 Spec archive

Already done. The U1 spec was moved to `docs/specs/u1-ux-fixes.md` in the same commit that added this file. Nothing to do here.

### 4.7 Remote databases: already done, do not run

Staging and prod are already up to date with every migration, including `20261115000002_new_tiers`. Do not run `db-push.ps1`, `supabase db push` or any SQL against a remote database in this build, and do not ask me for connection strings.

One optional read-only check, only if credentials are already available on this machine: run `npx supabase migration list --db-url <target>` and confirm local and remote match. If no credentials are available, skip it and say so in your summary.

## 5. Tests and verification

- Update `tests/unit/sqlConstants.test.ts` so the pinned values are:
  - `slots_max: 3`, `slots_ultra: 5`
  - `cap_pro: 400`
  - `price_pro: 99`, `price_max: 149`, `price_ultra: 249`

  It must still pass by parsing the **latest** definition of each constant across all migrations. If it currently reads only `20261111000001`, change it to take the newest `create or replace` for each function.
- Update unit, RLS and e2e tests that pin old prices, slot counts, caps or the "That's four" copy.
- Add an RLS test confirming that a Max user can create a 3rd active companion but not a 4th, and an Ultra user a 5th but not a 6th.
- Add an e2e test confirming that the plans screen shows ₹99, ₹149 and ₹249, plus the new Max and Ultra feature lines.
- Run lint, unit tests, build with no env vars, RLS tests and e2e tests against a local Docker Supabase stack rebuilt from scratch (`supabase db reset`), so the new migration applies on top of all earlier ones. Everything must pass.
- In the final summary, include:
  - the files changed,
  - the migration filename,
  - any test you had to change beyond the value updates, with the reason.

## 6. What stays outside Claude Code

Play Console base-plan prices for `ally_pro`, `ally_max` and `ally_ultra` (₹99, ₹149 and ₹249) cannot be set from this repo. Mention this as the one remaining item in your summary.

## 7. Out of scope

- Play Billing on Android (Babu).
- Any change to the trial, entry points, trust clamp or billing stub logic.
- Dropping the deprecated ledger columns.
- Any change to the chat model. It stays DeepSeek V4 Pro until the Flash tests are done.
