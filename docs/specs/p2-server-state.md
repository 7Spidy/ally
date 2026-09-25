# claude_change_spec.md — P2: Server-Side State (Companions, Messages, Ledger)

Phase 2 of 3. P1 (accounts and auth) is merged and live. P3 (admin console) comes after this. Repo baseline: `main` at `85d7300` plus the `pg_cron` follow-up (`af22fc3`).

---

## 0. Workflow for this phase (read first)

This phase runs differently from P1. You have full authority to test and ship without waiting for manual confirmation, within the boundaries below.

1. Implement the spec.
2. Run the full verification suite yourself, in your own sandboxed environment: `npm run lint`, `npm test`, `npm run build` with no env vars, `npm run db:start` + `npm run e2e:env` + `npm run test:rls` + `npm run e2e`. Do not skip the Docker-dependent steps and do not ask the user to run them, spin up local Supabase yourself the same way the P1 session did.
3. If everything passes: create a new branch `p2-server-state` off current `main`, commit, and push it. **Do not merge to `main` and do not open against any other branch.** Report the branch, the commit hash, and the full verification results.
4. If anything fails and you cannot fix it after reasonable attempts: do not push anything. Report exactly what failed, the actual error output, and what you tried.
5. If you find the working tree is not clean `main`, or `claude_change_spec.md` in the repo root is not this document, stop before writing any code and report it, don't guess which spec is correct.
6. There is no data to preserve. Wipe is intentional and specified below, don't add migration or backward-compatibility logic for existing local data.

---

## 1. Context & Goal

Right now, after P1, every user has a real identity (anonymous or linked), but their actual data, companions, chat messages, the ledger, onboarding answers, still lives in `localStorage` under `ally_v2:<uid>`. That means logging in on a second device shows an empty app. P2 moves that data to Supabase, so identity and data both travel with the account.

**What P2 does NOT change:** chat replies stay mocked (`replyFor` in `src/lib/copy.ts`), no LLM. The onboarding UI, matching engine (`src/lib/engine.ts`), and all screens stay as they are, only where their data lives changes. Payments stay mocked, `PRICE_SLOT_2/3`, `PRICE_DAY_PASS` in `config.ts` remain placeholders, `buyPass`/`unlock` are still triggered by mock purchase flows, not a real gateway.

## 2. Locked decisions

| # | Decision |
|---|---|
| D1 | Clean wipe. No migration of existing `ally_v2:<uid>` data, no backward-compat reads of the old local shape. On first load after this ships, every user (including Avi and Babu) starts fresh: no companions, ledger reset to `freshLedger`. |
| D2 | The ledger is exactly the model in `src/lib/ledger.ts`/`config.ts`: a rolling daily free allowance (`FREE_DAILY`, Asia/Kolkata day via `dayKey`), an optional day pass (`PASS_HOURS`/`PASS_CAP`), slot unlocks (`MAX_COMPANIONS`), and a list of parted (permanently removed) template ids. This is not rebuilt as a generic credits system, it moves as-is onto server tables. |
| D3 | All mutations that touch the ledger or create/modify a companion or message go through `SECURITY DEFINER` Postgres functions (RPCs), never a direct table write from the client. This is what makes the ledger and any future blocked/suspended checks trustworthy, a client can't just `UPDATE` its own row to grant itself credits. |
| D4 | `Message` content is stored server-side. There's no LLM yet, but message history is real user data (their side of a mocked conversation) and needs to survive a device switch. |
| D5 | Onboarding **in-progress** state (deck order, dwell times, likes, redraws, the mid-flow draft) stays in `localStorage`, unnamespaced-per-user is fine since it's pre-account, ephemeral, and abandoning it costs nothing. Only the **committed** result, a created companion at `CONFIRM_LOCK`, is written to the server, atomically, via one RPC. This mirrors D11 from the P1 spec (draft local, atomic commit) and avoids a chatty round trip on every deck swipe. |
| D6 | The reducer and its unit tests survive. `AllyProvider` keeps a client-side cache (`useReducer`) but every mutating action that touches server-owned state now calls an RPC first, then dispatches the server's confirmed result, it does not optimistically compute the new state and hope the server agrees. Pure local-only actions (deck browsing, toasts, sound toggles pre-account) still dispatch directly. |
| D7 | `state.user` (display name, consent, account linkage) is already covered by P1's `profiles`/`consents` tables and the `ACCOUNT_SAVE` flow; P2 does not duplicate it. `AllyState.user` in the client cache is populated from the auth session and `profiles`, not persisted separately. |
| D8 | The debug clock (`window.__allyClock`, `src/debug/DebugPanel.tsx`) only affects client-side date formatting after P2. Server-side day-rollover and pass-expiry math use the database's own `now()`, which cannot be skewed from the client. This is a deliberate behavior change from pre-P2 (where the debug panel could fast-forward the ledger) — call it out in the final report, don't silently degrade the debug panel without saying so. |
| D9 | Realtime/cross-tab sync is out of scope. A second open tab or device shows stale data until it re-fetches (on navigation or a manual action), no websocket subscription in this phase. |
| D10 | RLS pattern matches P1: policies plus explicit `GRANT`s on every table (P1 shipped without the grants once already, don't repeat that; write the grants in the same migration as the policies and double check every new table has both). |

## 3. Schema

New migration: `supabase/migrations/<next-timestamp>_server_state.sql`. Do not touch `20260920000001_auth_foundation.sql` or its later `pg_cron` fix.

| Table | Columns | Notes |
|---|---|---|
| `companions` | `id text primary key` (reuse the client's `c_<base36>` format, generated server-side in the create RPC), `user_id uuid references auth.users on delete cascade`, `template_id text`, `deck_gender text`, `answers jsonb`, `core jsonb`, `created_at timestamptz`, `last_opened_at timestamptz`, `status text check (status in ('active','parted'))`, `parted_at timestamptz`, `purge_at timestamptz`, `exchanges int default 0`, `unread int default 0`, `notify boolean default true`, `sound boolean default true` | One row per `Companion` minus `messages` (own table) |
| `messages` | `id bigint generated always as identity primary key`, `companion_id text references companions(id) on delete cascade`, `user_id uuid references auth.users on delete cascade`, `who text check (who in ('them','me'))`, `text text`, `created_at timestamptz default now()` | `user_id` is denormalized onto the row for a simple RLS check without a join; index on `(companion_id, created_at)` |
| `ledgers` | `user_id uuid primary key references auth.users on delete cascade`, `slots_unlocked int default 1`, `day text`, `free_used int default 0`, `pass_started_at timestamptz`, `pass_ends_at timestamptz`, `pass_used int`, `updated_at timestamptz default now()` | One row per user, mirrors `Ledger` minus the two history arrays |
| `ledger_unlocks` | `id bigint generated always as identity primary key`, `user_id uuid references auth.users on delete cascade`, `slot int`, `at timestamptz`, `amount int` | Append-only history of `LedgerUnlock` |
| `ledger_passes` | `id bigint generated always as identity primary key`, `user_id uuid references auth.users on delete cascade`, `started_at timestamptz`, `amount int` | Append-only history of `LedgerPassHistory` |
| `ledger_parted` | `user_id uuid references auth.users on delete cascade`, `template_id text`, primary key `(user_id, template_id)` | The `parted: string[]` set, as rows instead of an array so `unlock`/`part` don't need read-modify-write races |

RLS on every table: owner-only `select` (`user_id = auth.uid()` or, for `messages`, its own `user_id` column). **No client-side `insert`/`update`/`delete` grants on any of these tables at all** — every write goes through an RPC (D3). Grant `execute` on each RPC to `authenticated` only (not `anon`, since only a real, even if anonymous, Supabase session can call these; anonymous sessions are `authenticated`, this is fine).

## 4. RPCs (all `SECURITY DEFINER`, `set search_path = ''`, schema-qualified inside)

| Function | Signature | Behavior |
|---|---|---|
| `create_companion` | `(template_id text, deck_gender text, answers jsonb, core jsonb, display_name text)` returns the new companion row | Checks active companion count is within the caller's `slots_unlocked` (from `ledgers`, defaulting to 1 via an upsert if no ledger row exists yet). Generates the id, inserts the companion, updates `profiles.display_name` if `display_name` is non-empty and not already set. Mirrors `CONFIRM_LOCK` in the reducer. |
| `send_message` | `(companion_id text, body text)` returns `{ message: messages, ledger: ledgers, blocked: boolean }` | One transaction: verify the companion belongs to the caller and is `active`; call the same day-roll/`canSend` logic as `src/lib/ledger.ts` (port it to SQL, see §5); if capped/empty, return `blocked: true` and insert nothing; otherwise insert the `who:'me'` message, increment `exchanges`, debit the ledger (free or pass, matching `spend()`), return the new ledger state. This replaces `SEND_MESSAGE` + `SPEND_MESSAGE`. |
| `receive_reply` | `(companion_id text, body text)` returns the new message row | Inserts a `who:'them'` message, increments `unread`. Called by the client right after `send_message` succeeds, passing the text `replyFor()` already computed locally (the reply content itself is still generated client-side from `core.primary`/`exchanges`, since there's no LLM; only the persistence moves server-side). |
| `open_chat` | `(companion_id text)` | Sets `last_opened_at = now()`, `unread = 0`. Mirrors `OPEN_CHAT`. |
| `part_companion` | `(companion_id text)` | Sets `status='parted'`, `parted_at = now()`, `purge_at = now() + 30 days` (reuse `PART_PURGE_DAYS`, defined as a SQL constant matching `config.ts`, see §5 for the single-source-of-truth approach), inserts into `ledger_parted`. Mirrors `PART_COMPANION`. |
| `unlock_slot` | `(amount int)` | Increments `ledgers.slots_unlocked` by 1, capped at `MAX_COMPANIONS`, inserts a `ledger_unlocks` row. Mirrors `UNLOCK_SLOT`. This is the mock-purchase hook; the amount is trusted from the client for now since there's no real payment gateway, same trust level as the pre-P2 client-only version had. |
| `buy_pass` | `()` | No-op if a pass is already active (`pass_ends_at > now()`); otherwise sets `pass_started_at = now()`, `pass_ends_at = now() + PASS_HOURS hours`, `pass_used = 0`, inserts a `ledger_passes` row with `amount = PRICE_DAY_PASS`. Mirrors `BUY_PASS`. |
| `get_my_state` | `()` returns `{ companions, messages_by_companion, ledger, unlocks, passes, parted }` | One read RPC (or a plain `select` from the client, RLS-protected, is equally fine here since it's read-only, use whichever is simpler to implement correctly) that returns everything needed to hydrate the client cache on boot. Runs the purge-parted logic first (see next row). |
| `purge_parted_now` | `()` | Server-side equivalent of the `PURGE_PARTED` reducer case: for this user's companions where `status='parted'` and `purge_at <= now()`, clear `messages` (delete the rows) and reset `answers`/`core` to empty, `unread` to 0. Called at the start of `get_my_state` so a stale client always sees purged data, and also runnable by the existing `pg_cron` job (extend the nightly job from P1's migration to call this for every user, or add a second `cron.schedule` entry, either is fine, document which you chose). |

Port `rollDay`/`canSend`/`spend`/`passActive`/`freeLeft` from `src/lib/ledger.ts` into SQL faithfully, same free/pass/day logic, not a reinterpretation. `dayKey`'s Asia/Kolkata boundary should use `(now() AT TIME ZONE 'Asia/Kolkata')::date` or equivalent, verify this actually matches `Intl.DateTimeFormat` output at the boundary (midnight IST) with a test case in §7.

## 5. Single source of truth for constants

`FREE_DAILY`, `PASS_HOURS`, `PASS_CAP`, `MAX_COMPANIONS`, `PART_PURGE_DAYS` currently live only in `src/lib/config.ts`. SQL functions need the same numbers. Don't hardcode them twice where they can silently drift:
- Simplest correct option: the migration hardcodes the current values as SQL constants (via a small `create function ally_config_free_daily() returns int language sql immutable as $$ select 100 $$;` per constant, or just inline literals with a prominent comment `-- keep in sync with src/lib/config.ts`), and a new unit test (§7) asserts the TypeScript constants still match a hardcoded expectation, so a change to one side without the other fails CI rather than silently diverging.
- Pick this or a cleaner mechanism if one is obviously better once you're in the code, but don't leave the two sides with no test tying them together.

## 6. Client changes

### 6.1 Data layer
- New `src/lib/supabase/queries.ts` (or similar): thin wrappers around the RPC calls above, typed to match `schema.ts`'s shapes so the reducer's action payloads don't need to change shape.
- `AllyProvider` boot sequence: after auth is ready and a user id exists, call `get_my_state` (or the equivalent selects) instead of (or in addition to, per D5) reading `ally_v2:<uid>` for companions/ledger. `flow` (in-progress onboarding) still hydrates from localStorage per D5.
- `HYDRATE` dispatch now assembles `AllyState` from two sources: server (`companions`, `ledger`) and local (`flow`, and `user` from the auth/profile data already available via `useAuth`).

### 6.2 Reducer/action changes
Actions that become "fire the RPC, then dispatch the confirmed result" instead of pure local computation: `CONFIRM_LOCK`, `SEND_MESSAGE`, `RECEIVE_REPLY`, `OPEN_CHAT`, `PART_COMPANION`, `UNLOCK_SLOT`, `BUY_PASS`. Each call site (in `app/chat/[id]/page.tsx`, `app/onboarding/reveal/page.tsx`, `src/components/sheets/ledgerSheets.tsx`, etc.) becomes `async`, calls the query wrapper, then dispatches with the server's returned values rather than ones computed inline. Handle the RPC failure case (network error, blocked) with the existing `Toast`/`Sheet` patterns already in the codebase, don't invent a new error UI pattern.

Actions that stay pure local dispatch, no RPC: everything under onboarding flow (`SET_LOCATION` through `LEAVE_ROUND2`, `DECK_*`, `PROPOSE`, `REDRAW`), `SET_NOTIFY`/`SET_SOUND`/`SET_SOUND_ON`/`SET_UNMUTED` (these are lightweight preferences; move them server-side only if trivial to add as one more column update, otherwise leave local for this phase and note it as a later candidate rather than silently dropping the idea), the `DEBUG_*` actions (client-only, dev-mode as today, but see D8, they should now warn or no-op against the server-derived ledger fields rather than desyncing silently, decide the simplest correct behavior and document it).

### 6.3 Account/companion deletion
`hubSheets.tsx`'s delete-everything and `app/settings/account/page.tsx`'s delete-account flow (P1) both need to also clear server-side companions/messages/ledger rows for the anonymous-user case (P1's `purge_self()` already cascades via `on delete cascade` from `auth.users`, since every new table above has `on delete cascade` to `auth.users`, this should already work for free once the FKs are in place, verify it in a test rather than assuming).

### 6.4 Migrate.ts / storage key
`stateKeyFor`, `migrate()` keep working for the `flow`-only local piece. `wipeLegacy` behavior is unaffected. No new local storage key is introduced; `flow` still lives inside the same `ally_v2:<uid>` blob for simplicity, just with `companions`/`ledger` inside it now always reset to empty/fresh on every hydrate rather than read from storage (or restructure to a smaller local-only shape if that's cleaner, your call, but keep `migrate.ts`'s existing tests meaningful rather than gutting them).

## 7. Tests

Everything from P1's suite must still pass, e1-e21, `test:rls`, unit, build. New additions:

- **Unit:** a SQL-constants-match test per §5; reducer tests updated wherever an action's shape changed to accept a server-confirmed payload instead of computing one.
- **RLS:** for every new table, prove user A cannot read or write user B's rows, and that no `authenticated` role has direct `insert`/`update`/`delete` on any of the six new tables (only `execute` on the RPCs).
- **New Playwright specs** (name them e22+): create a companion end to end and confirm it's visible after a simulated "new device" (a fresh browser context, same authenticated user); send messages until the free daily cap via `send_message` and confirm the existing e7/e8-style cap behavior still holds now that it's server-enforced; part a companion and confirm the purge-at-30-days path still works with `purge_at` now server-side (fast-forward via inserting a row with a past `purge_at` directly, not trying to time-travel the server's own clock).
- Re-verify e7 (`free-messages`), e8 (`pass-cap`), e4 (`slot3-cap`), e5/e6 (`part`/`part-all`) specifically, since these are the exact behaviors moving from client-reducer to server-RPC, don't just trust they pass, read their assertions and confirm they're actually exercising the new server path, not silently short-circuiting because a mock still returns the old local shape somewhere.

## 8. Acceptance criteria
1. `npm run lint`, `npm test`, `npm run test:rls`, `npm run e2e`, and `npm run build` with no env vars all pass, run by you, not deferred to the user.
2. No table among the six new ones grants `insert`/`update`/`delete` to `anon` or `authenticated` directly, only RPC `execute`.
3. A fresh anonymous user with no prior data can complete onboarding, send messages up to the free cap, get capped, and the behavior matches what e7 already asserts.
4. Deleting an account (P1's flow) leaves no rows behind in any of the six new tables for that user id.
5. The old `ally_v2:<uid>` companions/ledger data, if any exists from before this ships, is never read or migrated, confirm by grep that no code path reads companion/ledger fields out of the local blob anymore except via the fresh-empty defaults.

Report the branch name, commit hash, and full verification output when done. Do not merge to `main`.
