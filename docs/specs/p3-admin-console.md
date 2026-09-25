# P3: Admin Console

Phase 3 of 3. P1 (accounts and auth) and P2 (server-side state) are merged on `main` at `972efac`. This file is meant to be committed at `docs/specs/p3-admin-console.md`, not the repo-root `claude_change_spec.md`, that root filename has already collided twice across unrelated workstreams sharing this repo; P3 doesn't reuse it.

---

## 0. Workflow for this phase (read first)

1. Before writing any code: `git pull` on `main`, confirm the working tree is clean, and confirm `git log --oneline -5` shows `972efac` (or a later commit) as an ancestor. If `main` has moved in a way that touches files this spec depends on (anything under `src/state/`, `src/lib/ledger.ts`, `src/lib/clock.ts`, `supabase/migrations/`) from a workstream other than P1/P2, stop and report what you found before proceeding, don't guess whether it's compatible.
2. Same autonomous-test workflow as P2: implement, run the full verification suite yourself (`npm run lint`, `npm test`, `npm run build` with no env vars, `npm run db:start` + `npm run e2e:env` + `npm run test:rls` + `npm run e2e`), and if everything passes, push to a new branch `p3-admin-console` off current `main`. **Do not merge to `main`.**
3. If anything fails and you can't fix it after reasonable attempts, don't push, report the actual failure.
4. This phase does not touch Supabase migrations that need a live push before testing, unlike P1/P2, everything here can be verified entirely against the local Docker stack. The new migration still needs a manual `db push` to `ally-staging`/`ally-prod` after merge, same pattern as before, call this out in your final report as a remaining manual step.
5. No data to preserve, same as P2. Admin role assignment is done by hand in SQL after this ships (see manual checklist), not by this build.

---

## 1. Context & Goal

Two people, Avi and Babu, need to see every user, adjust their limits, grant or end passes, suspend accounts, and force a logout, without touching the database directly. `profiles.role` ('user'/'admin') and `profiles.status` ('active'/'suspended') already exist from P1's migration but nothing reads or enforces them yet. This phase builds the `/admin` UI and the server-side plumbing it needs.

**What P3 does NOT change:** no self-service billing, no real payment gateway (`unlock_slot`/`buy_pass` remain mock-trusted from the client as they are today). No message-content moderation view, admins see metadata about a conversation, not its text.

## 2. Locked decisions (from the original blueprint, restated for P3)

| # | Decision |
|---|---|
| D1 | Admin access is `profiles.role = 'admin'`, checked both in `middleware.ts` (route guard) and inside every admin RPC (`is_admin()`, already defined in P1's migration, reused, not redefined). |
| D2 | Every admin write goes through a `SECURITY DEFINER` RPC that starts by asserting `is_admin()`, mirroring P2's pattern of RPC-only writes. No admin page ever issues a direct table `update`/`insert`/`delete` from the client. |
| D3 | Every admin write is logged: who did it, what changed, old value, new value, when. Two admins means "who granted this pass" needs an answer. |
| D4 | Admins can suspend/unsuspend, grant or end a pass, change `slots_unlocked`, override the free-daily cap per user, and force "log out everywhere". Admins cannot read message content. |
| D5 | `role` can only be granted to an account that already exists, no admin self-signup UI, promotion is a manual SQL step (see the manual checklist at the end). |
| D6 | Admin pages are Next.js Server Components where practical, fetching directly via the server Supabase client with the caller's own session (RLS's `is_admin()` branch on `profiles`/`consents` already allows this per P1), not routed through the service-role key. The service-role key stays reserved for `purge_self`-adjacent, user-initiated deletion flows only, per P1's original scoping, admin reads/writes don't need it since `is_admin()` grants visibility through ordinary RLS-aware RPCs. |

## 3. Schema

New migration: `supabase/migrations/<next-timestamp>_admin_console.sql`.

| Table | Columns | Notes |
|---|---|---|
| `user_limits` | `user_id uuid primary key references auth.users(id) on delete cascade`, `free_daily_override int`, `pass_cap_override int`, `updated_at timestamptz not null default now()`, `updated_by uuid references auth.users(id)` | `null` override means "use the global default from `ally_private.free_daily()`/`pass_cap()`". Row is created on first override, not on every user (avoid a row-per-user default with nothing to say). |
| `admin_audit` | `id bigint generated always as identity primary key`, `actor_id uuid not null references auth.users(id)`, `target_user_id uuid not null references auth.users(id)`, `action text not null`, `old_value jsonb`, `new_value jsonb`, `created_at timestamptz not null default now()` | Append-only. `action` values: `'suspend'`, `'unsuspend'`, `'grant_pass'`, `'end_pass'`, `'set_slots'`, `'set_free_daily_override'`, `'set_pass_cap_override'`, `'force_logout'`. |

RLS: `user_limits` and `admin_audit` are both `select`/`insert`/`update` only via `is_admin()` in the policy `using`/`with check` clause (admins can read each other's audit trail; a non-admin has zero access to either table, not even their own row, since these are operational tables, not user-facing data). No table grants `insert`/`update`/`delete` to `authenticated` directly, only RPC `execute`, same discipline as P2.

`ledger_json()` (defined in P2's migration, `ally_private.ledger_json`) needs to actually apply `user_limits` overrides when computing `can_send`/`free_used` displays. Check `ally_private.can_send()` and `ally_private.lock_ledger()` in `20260924000001_server_state.sql` and extend them (in this new migration, via `create or replace function`, don't edit the P2 file) to look up `user_limits` for the relevant user and use the override when present, falling back to `ally_private.free_daily()`/`pass_cap()` otherwise. This is the one place P3 actually changes P2's runtime behavior, not just adds new tables, call this out clearly in the final report since it's easy to miss that a limit override silently does nothing if the read path isn't updated too.

## 4. RPCs (all `SECURITY DEFINER`, `set search_path = ''`, every one starts with `if not ally_private.is_admin_uid(auth.uid()) then raise exception ... using errcode = '42501'; end if;` or equivalent using the existing `public.is_admin()`)

| Function | Signature | Behavior |
|---|---|---|
| `admin_list_users` | `(search text default null, cursor_created_at timestamptz default null, cursor_id uuid default null, limit_n int default 25)` returns a set/jsonb array | Paginated list: email (from `auth.users`, admins can see this via the function's elevated privilege even though `auth.users` itself isn't directly exposed to the client), `is_anonymous`, `created_at`, `last_sign_in_at`, `profiles.status`, companion count, message count, current ledger balance/pass state. `search` matches on email (case-insensitive substring). Order by `created_at desc, id desc`, keyset-paginate on the cursor pair rather than `offset`, since the users table can grow and offset pagination degrades. |
| `admin_get_user` | `(target uuid)` returns jsonb | Full detail for one user: everything from the list row, plus `user_limits` (if any), active companions with per-companion exchange/message counts (not message text), and the last 20 rows from `admin_audit` where `target_user_id = target`. |
| `admin_set_status` | `(target uuid, status text)` | `status` is `'active'` or `'suspended'`. Updates `profiles.status`, writes an `admin_audit` row (`action` = `'suspend'` or `'unsuspend'` based on direction). A suspended user can still authenticate (per the original blueprint decision), but P2's RPCs (`send_message` etc.) must refuse to act for a suspended user, check this is actually enforced (see §5) rather than assumed from the schema alone. |
| `admin_set_slots` | `(target uuid, slots int)` | Validates `1 <= slots <= ally_private.max_companions()`. Upserts `ledgers.slots_unlocked` for the target (creating the row if absent, same as P2's `lock_ledger` does). Writes `admin_audit`. |
| `admin_set_free_daily_override` | `(target uuid, value int)` | `value` of `null` clears the override. Upserts `user_limits`. Writes `admin_audit` with old/new values. |
| `admin_set_pass_cap_override` | `(target uuid, value int)` | Same pattern as above for `pass_cap_override`. |
| `admin_grant_pass` | `(target uuid, hours int default null)` | Defaults to `ally_private.pass_hours()` if `hours` is null. Sets `pass_started_at = now()`, `pass_ends_at = now() + (hours || ' hours')::interval`, `pass_used = 0` on the target's `ledgers` row (upsert if absent). Inserts a `ledger_passes` row with `amount = 0` (admin-granted, not a real purchase) — decide whether `ledger_passes.amount` should be nullable or admin grants need a sentinel; check the P2 schema's actual constraint on that column and don't violate it. Writes `admin_audit` action `'grant_pass'`. |
| `admin_end_pass` | `(target uuid)` | Sets `pass_ends_at = now()` on the target's ledger if a pass is currently active (no-op with a clear return value if none is active, don't error). Writes `admin_audit` action `'end_pass'`. |
| `admin_force_logout` | `(target uuid)` | This needs the service-role privilege (`auth.admin.signOut` or revoking refresh tokens is not available to a plain `SECURITY DEFINER` SQL function, it's an Admin API call, not a database operation). Implement this as a Next.js **route handler** (`app/api/admin/force-logout/route.ts`), not a Postgres RPC: it checks the caller's session is an admin (query `profiles.role` via the server client), then uses the service-role admin client to sign out the target user's other sessions. Write the `admin_audit` row from this same route (via a plain authenticated RPC insert-audit-row call, or directly with the service client, whichever is cleaner) since the action didn't originate in Postgres. |

`admin_list_users` and `admin_get_user` need access to `auth.users` fields (`email`, `is_anonymous`, `created_at`, `last_sign_in_at`) that aren't otherwise queryable by an ordinary authenticated role. A `SECURITY DEFINER` function can read `auth.users` directly since it runs as the function owner; confirm this works against the actual local Supabase auth schema rather than assuming a specific column list, `auth.users`' exact shape is Supabase-managed and can differ slightly by version, adapt field names to what's actually there if this spec's names don't match.

## 5. Enforcing suspension in P2's RPCs

`ally_private.own_companion()` and/or `ally_private.lock_ledger()` (in `20260924000001_server_state.sql`) need a suspension check added, via `create or replace function` in this new migration: if `profiles.status = 'suspended'` for the caller, `send_message`, `create_companion`, `unlock_slot`, and `buy_pass` should all fail with a clear error rather than silently succeeding. Read the existing function bodies first to find the single best insertion point (likely inside `require_uid()` or right after it, so every RPC that calls it gets the check for free) rather than duplicating a status check into each of the four RPCs separately.

## 6. Client (`/admin`)

### 6.1 Routing and access
- `middleware.ts`: add `/admin` and `/admin/*` to a new `'admin'` tier in `authRoutes.ts`'s `routeAccess()`, alongside the existing `'public'`/`'session'` tiers. A session user who isn't an admin hitting `/admin` redirects to `/home`, not `/`, they have a valid account, they're just not authorized for this section.
- `app/admin/layout.tsx`: server-side, checks `profiles.role` via the server client and redirects non-admins before rendering anything (defense in depth alongside the middleware check, and the RPCs' own `is_admin()` check is the real enforcement layer, this is just UX).

### 6.2 Pages
- `app/admin/page.tsx`: the user list. Search box, table (email or "Anonymous", joined date, last sign-in, status badge, companion count, message count, ledger summary), paginated via `admin_list_users`'s cursor.
- `app/admin/users/[id]/page.tsx`: detail view from `admin_get_user`. Sections: identity/status, ledger (current balance, override fields with inline edit, grant/end pass buttons), companions list (id, template, exchange count, status, no message text), audit log (last 20 actions on this user), a suspend/unsuspend toggle, a "log out everywhere" button.
- Every mutating control calls its RPC (or the force-logout route) via a client-side handler, shows a pending state, and refreshes the detail view from `admin_get_user` on success rather than optimistically guessing the new state, mirroring P2's D6 pattern (server-confirmed, not client-computed).

### 6.3 Styling
Reuse the app's existing component patterns (`Sheet`, `Toast`, whatever button/input primitives already exist in `src/components/`), don't introduce a separate design system for `/admin` just because it's an internal tool. Per the account's standing preference, if this touches any new HTML/CSS surface, keep it mobile-friendly with the white/gold/sage-green theme and no small font sizes, same as the rest of the app.

## 7. Tests

- **RLS:** a non-admin cannot call any `admin_*` RPC (expect the `is_admin()` exception), cannot select from `user_limits` or `admin_audit` even for their own `user_id`, and an admin can read/write both tables and call every RPC successfully against a second test user.
- **Enforcement:** a suspended user's `send_message`/`create_companion`/`unlock_slot`/`buy_pass` all fail with a clear error; an active user's don't.
- **Override plumbing:** set a `free_daily_override` for a user, confirm `send_message`'s cap behavior actually reflects the override (this is the part most likely to be silently wrong, per §3's warning, write the test to prove the override changes real behavior, not just that the row was written).
- **New Playwright specs** (e26+): an admin logs in, searches for a user, suspends them, confirms (via a second browser context as that user) that sending a message now fails; grants a pass and confirms the user's ledger reflects it; forces a logout and confirms a second session for that user is kicked out on next navigation; confirms a non-admin visiting `/admin` is redirected and cannot call `admin_list_users` directly.

## 8. Acceptance criteria
1. `npm run lint`, `npm test`, `npm run build` with no env vars, `npm run test:rls`, `npm run e2e` all pass, run by Claude Code itself.
2. Neither `user_limits` nor `admin_audit` grants direct `insert`/`update`/`delete` to `authenticated`, only RPC `execute` (and the audit table's own inserts happen only from inside the admin RPCs/route, never from a client call).
3. A suspended user is actually blocked from the four P2 mutating RPCs, verified by test, not just by reading the code.
4. A free-daily or pass-cap override actually changes `send_message`'s behavior for that user, verified by test.
5. `admin_force_logout` actually invalidates the target's other sessions, verified by a second-context E2E check, not just that the route returns 200.
6. Report the branch name, commit hash, and full verification output. Note in the report whether `docs/specs/p3-admin-console.md` had to deviate from this document because `main`'s state at pull time differed from what §0.1 expected.

---

## Manual checklist (after merge, not part of Claude Code's job)
1. `db push` the new migration to `ally-staging`, then `ally-prod`, same process as P1/P2.
2. Promote Avi and Babu: both must have signed in at least once (so their `auth.users`/`profiles` rows exist), then:
   ```sql
   update public.profiles set role = 'admin'
   where id in (select id from auth.users where email in ('<avi's linked email>', '<babu's linked email>'));
   ```
3. Smoke test on the live site: log in as an admin, confirm `/admin` loads and a non-admin account gets redirected away from it.
