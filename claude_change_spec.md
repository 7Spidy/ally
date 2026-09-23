# claude_change_spec.md — P1: Accounts and Auth (Supabase + Resend)

Phase 1 of 3. P2 moves companions, messages and the ledger to the server. P3 adds the admin console. Repo baseline: `84fb924`.

---

## 1. Context & Goal

Ally is a Next.js 15 PWA whose entire state is one `AllyState` blob in localStorage (`ally_v2`), with a stubbed account sheet that accepts a phone or email and verifies nothing. P1 makes identity real:

- Every visitor gets a Supabase **anonymous user** the moment they accept consent. The consent record is written server-side.
- The account sheet attaches a **verified email** (6-digit code) to that same user, then optionally a password.
- Returning users log in on any device with **email + code** (default) or **email + password**.
- Full **password reset** by code, **log out** (this device), **log out everywhere**, **delete account**.
- Sessions persist until logout (`@supabase/ssr` cookies, refreshed in middleware).
- Email is sent by Resend through Supabase's custom SMTP. No email code lives in this repo.

**What P1 does NOT change:** companions, messages, ledger and onboarding answers stay in localStorage. They are now namespaced per user ID (`ally_v2:<uid>`), so two people on one device don't see each other's data and logging out doesn't destroy anything. Cross-device data arrives in P2.

---

## 2. Locked decisions

| # | Decision |
|---|---|
| D1 | Anonymous-first identity: `signInAnonymously()` on consent; the account sheet links email via `updateUser({ email })` plus an OTP `type: 'email_change'`. Same UID throughout. |
| D2 | Phone is removed everywhere in UI. The schema type union may keep `"phone"` only for migration compatibility. |
| D3 | Login default is email + 6-digit code. "Use password instead" is secondary. Emails carry the code (primary) and a link (fallback). |
| D4 | Login and reset never reveal whether an email exists. UI copy: "If an account exists for {email}, we've sent a code." Accepted beta tradeoff: the raw Supabase error is visible in devtools. |
| D5 | Email collision during account linking (`email_exists`): offer "Log in instead", warning that this device's onboarding is discarded. No merging. |
| D6 | Password optional, min 8 chars, no composition rules. Offered once right after linking, and in Settings. |
| D7 | Password reset by code, entered in-app. After reset: `signOut({ scope: 'others' })`. |
| D8 | Settings offers "Log out" (local) and "Log out everywhere" (`scope: 'global'`). After logout the device shows the first-run splash. |
| D9 | Delete account requires typing `DELETE` plus a fresh email code. A server route then calls `auth.admin.deleteUser`. |
| D10 | Under-18 at the birthday step: call `purge_self()` to delete the anonymous user and consent row, sign out, keep the existing local `ally_blocked_until` behaviour. No minor data is retained. |
| D11 | Turnstile (invisible) on anonymous sign-in, OTP send, password login and reset. Supabase verifies the token natively. |
| D12 | Legacy data is wiped: the unnamespaced `ally_v2` key is deleted on first boot of this build. No import. |
| D13 | Environments: local Supabase via CLI in Docker for dev and tests; `ally-staging` project for Vercel Preview; `ally-prod` for Production. Both projects in Mumbai. |
| D14 | `profiles.role` ('user' or 'admin') and `profiles.status` ('active' or 'suspended') are created now. Users can never write them. They are used in P2 and P3. |
| D15 | User-visible copy and email templates contain **no em dashes**. |

---

## 3. Scope

### 3.0 Housekeeping (do first)
- Archive the previous spec before anything else: `mkdir -p docs/specs && git show HEAD:claude_change_spec.md > docs/specs/v3.0-review-fixes.md`.

### 3.1 Create
| Path | Purpose |
|---|---|
| `supabase/config.toml` | Via `npx supabase init`, then edited per §4.1 |
| `supabase/migrations/20260920000001_auth_foundation.sql` | Schema, RLS, functions, cron (§4.2) |
| `supabase/templates/{magic_link,email_change,recovery,reauthentication}.html` | Email templates (§4.3) |
| `src/lib/supabase/browser.ts` | Singleton `createBrowserClient` |
| `src/lib/supabase/server.ts` | `createServerClient` using async `cookies()` (Next 15) |
| `src/lib/supabase/admin.ts` | Service-role client; throws if imported where `typeof window !== 'undefined'` |
| `src/lib/authRoutes.ts` | Pure `routeAccess(pathname): 'public' \| 'session'` |
| `src/lib/authErrors.ts` | Maps Supabase error codes to `COPY` keys |
| `src/lib/accountFlow.ts` | Pure reducer for the account sheet's step machine |
| `src/lib/turnstile.tsx` | Invisible Turnstile component plus `useTurnstile()` returning `getToken(): Promise<string>` |
| `src/state/AuthProvider.tsx`, `src/state/useAuth.ts` | Session context |
| `src/components/auth/CodeInput.tsx` (+ `.module.css`) | 6-box OTP input |
| `src/components/auth/PasswordField.tsx` (+ css) | Password input with show/hide |
| `src/components/auth/ResendButton.tsx` | 60s countdown, then "Resend code" |
| `middleware.ts` (repo root) | Session refresh plus route guard |
| `app/login/page.tsx` (+ css) | Login: email, then code or password |
| `app/login/reset/page.tsx` (+ css) | Reset: email, code, new password |
| `app/auth/confirm/route.ts` | Link fallback: `verifyOtp({ token_hash, type })`, then redirect |
| `app/settings/account/page.tsx` (+ css) | Password set/change, log out, log out everywhere, delete |
| `app/api/account/delete/route.ts` | POST, service-role delete (§5.9) |
| `app/api/test/session/route.ts` | E2E-only anonymous session bootstrap (§6.2) |
| `.github/workflows/supabase-keepalive.yml` | Pings prod and staging every 3 days |
| `.env.example` | All variables from Appendix A, no values |
| `scripts/e2e-env.mjs` | Writes `.env.test.local` from `npx supabase status -o env` |
| `vitest.rls.config.ts`, `tests/rls/rls.test.ts` | RLS tests against local Supabase |
| `tests/e2e/mail.ts` | Reads codes from the local mail catcher |
| `tests/e2e/e15`–`e21` specs | §6.3 |
| `tests/unit/authRoutes.test.ts`, `tests/unit/accountFlow.test.ts`, `tests/unit/boot.test.ts` (extend if one exists) | §6.1 |

### 3.2 Modify
| Path | Change |
|---|---|
| `package.json` | Add `@supabase/supabase-js`, `@supabase/ssr` (deps) and `supabase` (devDep). Add scripts `db:start`, `db:stop`, `db:reset`, `test:rls`, `e2e:env`. No other dependencies. |
| `.gitignore` | `.env*.local`, `.env.test.local`, `supabase/.temp`, `supabase/.branches` |
| `app/layout.tsx` | Wrap in `<AuthProvider>` outside `<AllyProvider>` |
| `src/state/AllyProvider.tsx` | Per-user storage key and adoption rules (§5.2) |
| `src/lib/migrate.ts` | `migrate(storage, now, key = STATE_KEY)`; export `stateKeyFor(uid)`; add `wipeLegacy(storage)` |
| `src/lib/boot.ts` | `bootTarget(state, blocked, authed, now)` (§5.3) |
| `app/page.tsx` | Pass `authed`; call `wipeLegacy` once; add the "Log in" link on the first-run splash |
| `app/onboarding/consent/page.tsx` | Anonymous sign-in plus consent insert before `CONSENT` dispatch (§5.4) |
| `app/onboarding/birthday/page.tsx` | Under-18 path calls `purge_self` (§5.5) |
| `src/components/sheets/AccountSheet.tsx` (+ css) | Rewritten as email, code, optional password (§5.6). Props contract unchanged. |
| `src/components/sheets/hubSheets.tsx` | Delete-everything action (§5.10) |
| `app/settings/page.tsx` | "Signed in with" row shows the email or "Not saved yet"; new row goes to `/settings/account` |
| `src/lib/copy.ts` | New keys (§5.12). Remove phone copy. |
| `src/lib/config.ts` | `CONSENT_VERSION = "2026-09-v1"`, `OTP_LENGTH = 6`, `OTP_RESEND_SECONDS = 60`, `PASSWORD_MIN = 8`, `DELETE_REAUTH_MINUTES = 10` |
| `tests/e2e/helpers.ts` | Seed via `/api/test/session` and the namespaced key (§6.2) |
| `playwright.config.ts` | `webServer.env` from `.env.test.local`; set `ALLY_E2E=1`, `NEXT_PUBLIC_TURNSTILE_BYPASS=1` |
| `tests/unit/migrate.test.ts` | Cover the `key` param and `wipeLegacy` |
| vitest config (existing or default) | `npm test` must exclude `tests/rls/**`; everything it runs today must still run |

### 3.3 Out of scope (do not touch)
- Server persistence of companions, messages, ledger or onboarding answers (P2).
- DOB storage server-side (P2). The debug clock (P2).
- `/admin` (P3). The `admin_audit` table (P3).
- Consent body copy ("Your answers stay on this device until you make an account") stays as-is; it's still true after P1.
- Email change for permanent users. Google sign-in. Phone auth.

---

## 4. Supabase

### 4.1 `supabase/config.toml` (local stack; prod is set in the dashboard per the manual checklist)
Set or confirm:
```toml
[auth]
site_url = "http://127.0.0.1:3000"
additional_redirect_urls = ["http://127.0.0.1:3000/**", "http://localhost:3000/**", "http://127.0.0.1:3100/**"]
enable_anonymous_sign_ins = true
minimum_password_length = 8
jwt_expiry = 3600
enable_refresh_token_rotation = true

[auth.rate_limit]
email_sent = 1000          # local only; prod is 30/h
anonymous_users = 1000     # local only; e2e creates many
sign_in_sign_ups = 1000
token_verifications = 1000

[auth.captcha]
enabled = true
provider = "turnstile"
secret = "1x0000000000000000000000000000000AA"   # Cloudflare's always-pass test secret

[auth.email]
enable_signup = true
enable_confirmations = true
secure_password_change = true
double_confirm_changes = true
max_frequency = "60s"
otp_length = 6
otp_expiry = 600

[auth.email.template.magic_link]
subject = "Your Ally code: {{ .Token }}"
content_path = "./supabase/templates/magic_link.html"

[auth.email.template.email_change]
subject = "Confirm your email for Ally: {{ .Token }}"
content_path = "./supabase/templates/email_change.html"

[auth.email.template.recovery]
subject = "Reset your Ally password: {{ .Token }}"
content_path = "./supabase/templates/recovery.html"

[auth.email.template.reauthentication]
subject = "Your Ally confirmation code: {{ .Token }}"
content_path = "./supabase/templates/reauthentication.html"
```
Key names drift between CLI versions. Match the generated file's actual key names rather than forcing these verbatim.

### 4.2 Migration `20260920000001_auth_foundation.sql`
```sql
create extension if not exists pg_cron;

create type public.user_role   as enum ('user', 'admin');
create type public.user_status as enum ('active', 'suspended');

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 40),
  role         public.user_role   not null default 'user',
  status       public.user_status not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.consents (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  version    text not null,
  marketing  boolean not null default false,
  granted_at timestamptz not null default now()
);
create index consents_user_id_idx on public.consents (user_id);

-- Profile row for every new auth user (anonymous included)
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Admin check, used by RLS now and admin RPCs in P3. Security definer avoids RLS recursion.
create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

alter table public.profiles enable row level security;
alter table public.consents enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Column-level lock: users may only ever write display_name
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy consents_select_own on public.consents for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy consents_insert_own on public.consents for insert to authenticated
  with check (user_id = auth.uid());
revoke update, delete on public.consents from anon, authenticated;

-- Under-18 purge: anonymous users only
create function public.purge_self() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.users where id = auth.uid() and is_anonymous = true;
  if not found then
    raise exception 'purge_self is only allowed for anonymous users' using errcode = '42501';
  end if;
end $$;
revoke execute on function public.purge_self() from public, anon;
grant  execute on function public.purge_self() to authenticated;

-- Keep-alive target for the GitHub Action
create function public.ping() returns integer language sql stable as $$ select 1 $$;
grant execute on function public.ping() to anon, authenticated;

-- Nightly 03:00 IST: reap anonymous users idle for 30 days
select cron.schedule(
  'purge-stale-anonymous-users',
  '30 21 * * *',
  $$ delete from auth.users
     where is_anonymous = true
       and coalesce(last_sign_in_at, created_at) < now() - interval '30 days' $$
);
```
If `create extension pg_cron` fails on the hosted project, leave the migration as-is. The manual checklist enables it in the dashboard first.

### 4.3 Email templates (`supabase/templates/*.html`)
- Single-column, inline CSS only (email clients strip `<style>`), max width 480px, system font stack.
- Colours: background `#FFFFFF`, headings and code `#2B2B2B`, accent rule and button `#B8923A` (gold), secondary text `#6F8A68` (sage). Body text 16px minimum; code 32px, letter-spacing 8px, monospace.
- No em dashes anywhere. Footer: "Didn't ask for this? You can safely ignore this email."
- Each template states the 10-minute validity.

| Template | Heading | Code | Link (fallback button "Or tap to continue") |
|---|---|---|---|
| magic_link | "Your code to log in to Ally" | `{{ .Token }}` | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/home` |
| email_change | "Confirm your email" | `{{ .Token }}` | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change&next=/home` |
| recovery | "Reset your password" | `{{ .Token }}` | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/login/reset?step=new` |
| reauthentication | "Confirm it's you" | `{{ .Token }}` | none (code only) |

---

## 5. Implementation steps

### 5.1 Clients, AuthProvider, middleware
1. `browser.ts`: `createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)`. Lazy singleton, so `next build` never needs env values at import time.
2. `server.ts`: the standard `@supabase/ssr` server client with `await cookies()` get/set. Setting cookies in Server Components is wrapped in try/catch, because middleware does the refresh.
3. `admin.ts`: `createClient(URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })`. Throws immediately if `typeof window !== 'undefined'`.
4. `AuthProvider`:
   - Exposes `{ ready, user, isAnonymous, email, hasPassword }`.
   - Reads the initial session with `getSession()` and subscribes to `onAuthStateChange`.
   - `hasPassword` comes from `user.user_metadata.has_password === true`.
5. `middleware.ts`:
   - Session refresh: standard `@supabase/ssr` `updateSession` pattern. Use `supabase.auth.getClaims()` if the installed version has it, otherwise `getUser()`.
   - Route guard: `routeAccess(pathname) === 'session'` with no user redirects to `/` (preserve nothing).
   - Matcher excludes `_next/static`, `_next/image`, `/assets/`, `/favicon`, `/manifest`, `*.png|jpg|webp|svg|mp4|json`.
6. `authRoutes.ts`:
   - **Public:** `/`, `/onboarding/consent`, `/blocked`, `/login` and `/login/*`, `/auth/*`, `/api/test/*`.
   - **Session:** everything else, including `/onboarding/*`, `/home`, `/chat/*`, `/profile/*`, `/settings/*`, `/api/account/*`.
   - Anonymous sessions count as sessions.

### 5.2 AllyProvider: per-user storage
- Storage key is `stateKeyFor(uid) = "ally_v2:" + uid`. With no user, state lives in memory only and the persist effect is skipped.
- Keep the existing hydration-order guarantees and comments. `ready` becomes true only when **auth is ready** and hydration for the current owner has run.
- Track `ownerRef` (the UID the in-memory state belongs to). On auth change:

| From → To | Rule |
|---|---|
| none → uid, and stored `ally_v2:uid` is absent | **Adopt**: keep the in-memory state, set owner = uid, persist under the new key. This covers the consent step. |
| none → uid, stored state exists | Hydrate from the key (normal returning login). |
| uidA → uidB | Hydrate from `ally_v2:uidB`, or a fresh state if absent. If uidA was anonymous, remove `ally_v2:uidA` after the switch. |
| uid → none (logout) | Reset to the fresh placeholder in memory. Do **not** delete `ally_v2:uid`; data is device-local until P2. |

- After hydrating for a permanent user whose `state.user.accountAt` is null, dispatch `ACCOUNT_SAVE { contact: email, kind: "email", now }`. This covers logging in on a device where the account step never ran.
- `PURGE_PARTED` still runs after every hydrate.

### 5.3 Boot
- `bootTarget(state, blocked, authed, now)`:
  - `blocked` returns `blocked` (unchanged, checked first).
  - `!authed` returns `{ phase: "first-splash", step: "consent" }`, ignoring any in-memory state.
  - Otherwise, the existing logic is unchanged.
- In `app/page.tsx`:
  - Wait for Ally `ready` (which now implies auth ready).
  - Call `wipeLegacy(localStorage)` once. It deletes the exact key `ally_v2` only, not `ally_v2:*`, not `ally_blocked_until`, not `ally_session`.
  - Add a quiet link under the first-run splash action: "Already have an account? Log in" pointing to `/login`.

### 5.4 Consent: anonymous sign-in
On Continue:
1. Disable the button and show a busy state.
2. If there is no session: get a token via `useTurnstile().getToken()`, then call `signInAnonymously({ options: { captchaToken } })`.
3. Insert `consents { user_id, version: CONSENT_VERSION, marketing }`.
4. Then `dispatch({ type: "CONSENT", ... })` and `router.push("/onboarding/location")`.

On any failure, show a toast (`COPY.auth.network` or the mapped error), stay on the page, and re-enable. If a session already exists (re-entering consent), skip step 2 but still insert the consent row. The adoption rule in §5.2 carries the in-memory flow across the UID change; the push must happen only after `ownerRef` equals the new UID (await a provider-exposed `ownerId`).

### 5.5 Birthday: under-18
When `applyGate(...).blocked`, in order:
1. Write the local `BLOCK_KEY` (existing behaviour).
2. `await supabase.rpc("purge_self")`. Log and ignore errors; the block must hold offline.
3. `await supabase.auth.signOut({ scope: "local" })`.
4. Remove `ally_v2:<uid>`.
5. `router.replace("/blocked")`.

### 5.6 AccountSheet rewrite
- The props contract is unchanged: `personaName`, `exchanges`, `onSaved`, `blocking`. So is the dismissible rule (`exchanges < 7`) and the `dismissForNavigation()` usage and its comment. Replace the header comment's "stubbed" explanation with a short description of P1 behaviour.
- The step machine lives in `accountFlow.ts` (pure, unit-tested): `email → code → password → done`, plus `collision` and `error` states.

| Step | Action |
|---|---|
| email | Validate the format. `updateUser({ email })`. On success go to `code`. On `email_exists` go to `collision`. |
| code | `CodeInput`. `verifyOtp({ email, token, type: "email_change" })`. On success dispatch `ACCOUNT_SAVE { contact: email, kind: "email", now }` and go to `password`. Resend via `updateUser({ email })` again after 60s. |
| password | Skippable. "Save" calls `updateUser({ password, data: { has_password: true } })`. Skip or save goes to `done`. |
| done | `dismissForNavigation(); onSaved?.()` |
| collision | Copy per §5.12. "Log in" routes to `/login?email=<encoded>&discard=1`. "Use another email" goes back to `email`. |

- The sheet cannot be dismissed while `verifyOtp` is in flight.
- If the user dismisses at `code`, the pending email change is harmless; reopening starts at `email`.

### 5.7 Login (`/login`)
- Prefill the email from `?email=`.
- If the current session is anonymous and local state has companions or a flow past consent, show a `COPY.auth.loseOnboarding` confirm before sending anything.
- **Code path:**
  1. Get a Turnstile token, then `signInWithOtp({ email, options: { shouldCreateUser: false, captchaToken } })`.
  2. Regardless of the result (except rate limit or network), show `COPY.login.sent`.
  3. Show `CodeInput`, then `verifyOtp({ email, token, type: "email" })`, then `router.replace("/")` so boot routes to home or chat.
- **Password path:** `signInWithPassword({ email, password, options: { captchaToken } })`. On failure show `COPY.login.badLogin` only.
- Links: "Use password instead" / "Use a code instead" toggle, and "Forgot password?" goes to `/login/reset?email=`.
- The previous anonymous user's local key is removed per §5.2. The cron job reaps the server row.

### 5.8 Reset (`/login/reset`)
1. Email step: Turnstile token, then `resetPasswordForEmail(email, { captchaToken, redirectTo: SITE_URL + "/auth/confirm?type=recovery&next=/login/reset?step=new" })`, then the generic `COPY.reset.sent`.
2. Code step: `verifyOtp({ email, token, type: "recovery" })`.
3. New-password step (also reachable via `?step=new` from the link path when a session exists): `updateUser({ password, data: { has_password: true } })`, then `signOut({ scope: "others" })`, then a `COPY.reset.done` toast, then `router.replace("/")`.
4. `?step=new` with no session redirects to step 1.

### 5.9 Settings > Account (`/settings/account`)
- **Email row:** `email`, or `COPY.settings.notSaved` when anonymous. When anonymous, a "Save your account" row opens the AccountSheet with `exchanges: 1`.
- **Password row:** "Set password" when `!hasPassword`, otherwise "Change password".
  1. Call `updateUser({ password, data: { has_password: true } })`.
  2. If the error code is `reauthentication_needed`, call `reauthenticate()`, show `CodeInput`, then `updateUser({ password, nonce: code, data: { has_password: true } })`.
  3. Hidden for anonymous users.
- **Log out:** `signOut({ scope: "local" })`, then `/`.
- **Log out everywhere:** confirm (`COPY.settings.logOutAllConfirm`), then `signOut({ scope: "global" })`, then `/`.
- **Delete account** (permanent users only):
  1. The user types `DELETE` to continue.
  2. `signInWithOtp({ email, options: { shouldCreateUser: false } })`, then `CodeInput`, then `verifyOtp({ email, token, type: "email" })`.
  3. `POST /api/account/delete`.
  4. On 200: `signOut({ scope: "local" })`, remove `ally_v2:<uid>`, `router.replace("/")`.
- **`/api/account/delete` handler:**
  1. Resolve the caller from the server client.
  2. Read the JWT `amr` claim.
  3. Require an entry with method `otp` or `magiclink` whose timestamp is within `DELETE_REAUTH_MINUTES`. Otherwise return 403 `{ error: "reauth_required" }`.
  4. `adminClient.auth.admin.deleteUser(uid)`; the FK cascades clean up.
  5. Return 200.
  6. Never accept a UID from the request body.

### 5.10 hubSheets delete-everything
- Anonymous session: `rpc("purge_self")`, `signOut({ scope: "local" })`, remove `ally_v2:<uid>`, then the existing `DELETE_ALL` behaviour.
- Permanent session: route to `/settings/account` and open the delete flow instead of wiping silently.
- Keep the existing `BLOCK_KEY` and `SESSION_KEY` handling exactly as it is.

### 5.11 `/auth/confirm` route
`GET ?token_hash&type&next`:
1. Run `verifyOtp({ token_hash, type })` via the server client.
2. On success, redirect to `next`, but only if it's a same-origin relative path starting with `/`; otherwise go to `/`.
3. On failure, redirect to `/login?error=link` and show `COPY.login.linkFailed`.

Allowed types: `email`, `email_change`, `recovery`.

### 5.12 Copy (`src/lib/copy.ts`), no em dashes
```
auth.network         "Couldn't reach Ally. Check your connection and try again."
auth.rateLimited     "Too many tries. Wait a minute and try again."
auth.wrongCode       "That code didn't work. Check it or ask for a new one."
auth.expiredCode     "That code has expired. Ask for a new one."
auth.captcha         "We couldn't confirm you're human. Try again."
auth.loseOnboarding  "Logging in will discard what you've set up on this device. Continue?"
auth.codeLabel       "6-digit code"
auth.resendIn        "Resend in {s}s"
auth.resend          "Resend code"

splash.login         "Already have an account? Log in"

account.field        "Email"
account.send         "Send code"
account.codeSub      "We've sent a 6-digit code to {email}. It's valid for 10 minutes."
account.collision    "This email already has an account. Log in instead? What you've set up here won't carry over."
account.collisionLogin "Log in"
account.collisionOther "Use another email"
account.passwordHeading "Want a password too?"
account.passwordSub  "You can always log in with a code instead."
account.passwordSave "Save password"
account.skip         "Skip for now"

login.title          "Welcome back"
login.sendCode       "Send code"
login.usePassword    "Use password instead"
login.useCode        "Use a code instead"
login.password       "Password"
login.submit         "Log in"
login.forgot         "Forgot password?"
login.sent           "If an account exists for {email}, we've sent a code. It's valid for 10 minutes."
login.badLogin       "Email or password is incorrect."
login.linkFailed     "That link didn't work. Ask for a new code instead."

reset.title          "Reset your password"
reset.sent           "If an account exists for {email}, we've sent a code. It's valid for 10 minutes."
reset.newPassword    "New password"
reset.min            "At least 8 characters"
reset.submit         "Update password"
reset.done           "Password updated. You're logged in."

settings.account     "Account"
settings.notSaved    "Not saved yet"
settings.saveAccount "Save your account"
settings.setPassword "Set password"
settings.changePassword "Change password"
settings.logOut      "Log out"
settings.logOutAll   "Log out everywhere"
settings.logOutAllConfirm "This logs you out on every device, including this one."
settings.delete      "Delete account"
settings.deleteConfirm "This permanently deletes your account and everything in it. Type DELETE to continue."
settings.deleteCode  "We've sent a code to {email} to confirm."
```
Remove `settings.signedInPhone` and any phone placeholder text. If `copy.test.ts` enumerates keys, extend it; add an assertion that no `COPY` string contains `—`.

### 5.13 `authErrors.ts` mapping
| Code | COPY key |
|---|---|
| `otp_expired` | `auth.expiredCode` |
| `invalid_credentials` | `login.badLogin` |
| `over_email_send_rate_limit`, `over_request_rate_limit` | `auth.rateLimited` |
| `captcha_failed` | `auth.captcha` |
| `email_exists` | handled by the flow (collision) |
| `reauthentication_needed` | handled by the flow |
| `weak_password` | `reset.min` |
| network / `TypeError` | `auth.network` |
| any other | `auth.wrongCode` on code steps, `auth.network` elsewhere |

### 5.14 Turnstile
- Load `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` once.
- Render one invisible widget per page that needs it. `getToken()` executes and resolves the token; call `turnstile.reset()` after each use, since tokens are single-use.
- When `NEXT_PUBLIC_TURNSTILE_BYPASS === "1"`, skip the script and resolve `"XXXX.DUMMY.TOKEN.XXXX"`. This passes only against Cloudflare's test secret.
- `.env.example` and a code comment state that this flag must never be set on Vercel.

### 5.15 Keep-alive workflow
- `.github/workflows/supabase-keepalive.yml`: `schedule: cron "0 3 */3 * *"` plus `workflow_dispatch`.
- For each of prod and staging: `curl -fsS -X POST "$URL/rest/v1/rpc/ping" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"`.
- Secrets: `PROD_SUPABASE_URL`, `PROD_SUPABASE_PUBLISHABLE_KEY`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_PUBLISHABLE_KEY`.

---

## 6. Tests

**Prerequisite for every test run:** Docker running, then `npm run db:start` (`npx supabase start`) and `npm run e2e:env`.

### 6.1 Unit (`npm test`, no Supabase needed)
- `authRoutes.test.ts`: every route in §5.1.6, including nested chat and settings paths and query strings.
- `accountFlow.test.ts`: every transition, including collision → email, error recovery, and resend.
- `boot.test.ts`: the `!authed` branch overrides stale local state; `blocked` still wins over everything.
- `migrate.test.ts`: the `key` param, `stateKeyFor`, and `wipeLegacy` deleting only `ally_v2`.
- `copy.test.ts`: the no-em-dash assertion.

### 6.2 E2E harness
- `scripts/e2e-env.mjs` writes `.env.test.local` with:
  - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the anon or publishable key), and `SUPABASE_SECRET_KEY` (the service-role or secret key), all from `npx supabase status -o env`.
  - `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100`, `NEXT_PUBLIC_TURNSTILE_BYPASS=1`, `ALLY_E2E=1`.
- `app/api/test/session/route.ts`:
  - Returns 404 unless `process.env.ALLY_E2E === "1"`.
  - Otherwise, with the server client: `signInAnonymously({ options: { captchaToken: "XXXX.DUMMY.TOKEN.XXXX" } })`, which sets cookies. Inserts a consent row and returns `{ userId }`.
- `helpers.ts`:
  1. `page.goto("/api/test/session")` and read `userId`.
  2. `addInitScript` seeds `ally_v2:<userId>` instead of `ally_v2`.
  3. Then navigate as before.
  - The existing e1–e14 specs must pass with only helper changes. e1 (true first run) goes through the real consent path with the Turnstile bypass.
- `mail.ts`:
  - Poll the local mail catcher for the newest message to an address and extract `/\b\d{6}\b/`.
  - Newer CLIs ship Mailpit (`http://127.0.0.1:54324/api/v1/search?query=to:<addr>`); older ones ship Inbucket (`/api/v1/mailbox/<name>`). Detect which is running and support it.
  - Each test uses a unique address, `e2e+<uuid>@redream.in`.

### 6.3 New E2E specs
| Spec | Asserts |
|---|---|
| e15-account-link | First exchange, then sheet, then email and code from mail, then the password step (skip). Settings shows the email. Same UID before and after. |
| e16-account-collision | A pre-created user (admin API) with email X; an anonymous user tries X and sees collision copy; "Log in" lands on `/login` prefilled. |
| e17-login-otp | New context, login with code, lands on home. Unknown email shows the identical generic message and sends no mail. |
| e18-login-password | Set a password via Settings, log out, log in with password. Wrong password shows `login.badLogin`. |
| e19-reset | Reset by code, new password works, old one fails, a second context's session is revoked. |
| e20-logout-everywhere | Two contexts on the same user; "Log out everywhere" in A; B is bounced to `/` on next navigation. |
| e21-under18-and-guards | An under-18 DOB purges the anonymous user (admin API confirms deletion) and lands on `/blocked`. With no session, `/home` redirects to `/`. The delete-account flow removes the user. |

### 6.4 RLS (`npm run test:rls`, vitest with `vitest.rls.config.ts`)
- Two users, A and B, created via the admin API with passwords, each signed in with its own client.
- A cannot select B's `profiles` or `consents` rows.
- A cannot update its own `role` or `status` (permission error), but can update `display_name`.
- A cannot insert a consent with `user_id = B`.
- `purge_self` as a permanent user raises 42501 and the user still exists. As an anonymous user it deletes the user and cascades the rows.
- An anonymous client with no session cannot read either table.

---

## 7. Acceptance criteria
1. `npm run lint`, `npm test`, `npm run test:rls`, `npm run e2e` all pass with the local stack running.
2. `npm run build` passes with **no** env vars set (no import-time client construction).
3. No phone input or phone copy remains in UI code.
4. `SUPABASE_SECRET_KEY` is referenced only in `src/lib/supabase/admin.ts` and scripts/tests. Verify with grep.
5. `ALLY_E2E` and `NEXT_PUBLIC_TURNSTILE_BYPASS` are referenced only by the test route, Turnstile and test tooling.
6. `grep -rn "—" src app supabase/templates` finds no user-visible strings.
7. `.env.example` lists every variable in Appendix A.

## 8. Verify against current docs before coding
These are the three assumptions most likely to have drifted:
- (a) Linking email to an anonymous user uses `updateUser({ email })` and is verified with `verifyOtp({ type: "email_change" })` using `{{ .Token }}` from the Change Email template.
- (b) The `amr` claim format for OTP sign-ins, used in §5.9.
- (c) The local mail catcher (Mailpit vs Inbucket) and `supabase status -o env` variable names.

If any differs, adapt the implementation to preserve the behaviour described here and note the change in the final summary.

---

## Appendix A: Environment variables
| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all | |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all | Publishable (`sb_publishable_…`) or legacy anon key |
| `SUPABASE_SECRET_KEY` | server only | Secret (`sb_secret_…`) or legacy service-role key |
| `NEXT_PUBLIC_SITE_URL` | all | `https://ally.redream.in` in prod |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | all | Real key in prod; Cloudflare test key `1x00000000000000000000AA` in Preview/dev |
| `NEXT_PUBLIC_TURNSTILE_BYPASS` | e2e only | Never on Vercel |
| `ALLY_E2E` | e2e only | Never on Vercel |
