-- B2: live chat with Ira (docs: claude_change_spec_B2.md, section 4.2).
-- Trust arc columns, the per-companion memory vault tables, safety events, the
-- server-written reply function, the age-check and context-card RPCs, and the
-- nightly jobs. Written as `create or replace` over P2/P3 functions so the
-- applied migrations stay untouched.

-- ---------------------------------------------------------------------------
-- Pass cap (D12): the hidden day-pass cap drops from 2000 to 200.
-- Keep in sync with src/lib/config.ts (tests/unit/sqlConstants.test.ts).
-- ---------------------------------------------------------------------------
create or replace function ally_private.pass_cap() returns int language sql immutable set search_path = '' as $$ select 200 $$;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.companions
  add column trust_level int not null default 1 check (trust_level between 1 and 6),
  add column highest_level int not null default 1,
  add column trust_points int not null default 0 check (trust_points >= 0),
  add column level_changed_at timestamptz,
  add column last_drop_at timestamptz,
  add column below_since text,            -- IST day key when TP first fell below the current threshold
  add column signal_since_level boolean not null default false,
  add column cool_off_until timestamptz,
  add column safety_until timestamptz,    -- no romance until
  add column trust_frozen_until timestamptz,
  add column paused_reason text check (paused_reason in ('age_check')),
  add column last_replied_msg bigint not null default 0,
  add column last_ctx_day text;

alter table public.messages
  add column meta jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object'),
  add column in_reply_to bigint references public.messages(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.trust_days (
  companion_id text not null references public.companions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day text not null,
  msg_points int not null default 0,
  session_bonus boolean not null default false,
  disclosure_bonus boolean not null default false,
  user_msgs int not null default 0,
  primary key (companion_id, day)
);

create table public.memory_facts (
  id bigint generated always as identity primary key,
  companion_id text not null references public.companions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('people','work','schedule','dates','tastes','jokes','promises','other')),
  fact text not null check (char_length(fact) <= 280),
  active boolean not null default true,
  source_day text not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index memory_facts_companion_idx on public.memory_facts (companion_id, active);

create table public.memory_summaries (
  id bigint generated always as identity primary key,
  companion_id text not null references public.companions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null check (period in ('day','week')),
  period_key text not null,               -- YYYY-MM-DD (IST) or the ISO week's Sunday YYYY-MM-DD
  summary text not null check (char_length(summary) <= 1600),
  created_at timestamptz not null default now(),
  unique (companion_id, period, period_key)
);

create table public.safety_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  companion_id text references public.companions(id) on delete set null,
  kind text not null check (kind in ('concern','acute','age_claim','backstop')),
  created_at timestamptz not null default now()
);  -- never stores message text
create index safety_events_user_idx on public.safety_events (user_id, created_at);

-- ---------------------------------------------------------------------------
-- RLS and grants. Users read their own facts and summaries (a future "what
-- Ira remembers" view); nothing else is client-readable except by admins.
-- ---------------------------------------------------------------------------
alter table public.trust_days enable row level security;
alter table public.memory_facts enable row level security;
alter table public.memory_summaries enable row level security;
alter table public.safety_events enable row level security;

create policy memory_facts_select_own on public.memory_facts for select to authenticated using (user_id = (select auth.uid()));
create policy memory_summaries_select_own on public.memory_summaries for select to authenticated using (user_id = (select auth.uid()));
create policy trust_days_admin_select on public.trust_days for select to authenticated using ((select public.is_admin()));
create policy safety_events_admin_select on public.safety_events for select to authenticated using ((select public.is_admin()));

revoke all on public.trust_days, public.memory_facts, public.memory_summaries, public.safety_events from anon, authenticated;
grant select on public.trust_days, public.memory_facts, public.memory_summaries, public.safety_events to authenticated;
grant select, insert, update, delete on public.trust_days, public.memory_facts, public.memory_summaries, public.safety_events to service_role;
grant usage, select on sequence public.memory_facts_id_seq, public.memory_summaries_id_seq, public.safety_events_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Live rule (D1), mirroring src/lib/live.ts isLive()
-- ---------------------------------------------------------------------------
create function ally_private.is_live(c public.companions) returns boolean
language sql immutable set search_path = '' as $$
  select c.template_id = 'F01' and c.core->>'primary' = 'ROMANTIC'
$$;

-- ---------------------------------------------------------------------------
-- Client JSON: new fields. trust_points and thresholds are never exposed.
-- ---------------------------------------------------------------------------
create or replace function ally_private.companion_json(c public.companions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id,
    'templateId', c.template_id,
    'deckGender', c.deck_gender,
    'answers', c.answers,
    'core', c.core,
    'createdAt', ally_private.ms(c.created_at),
    'lastOpenedAt', ally_private.ms(c.last_opened_at),
    'status', c.status,
    'partedAt', ally_private.ms(c.parted_at),
    'purgeAt', ally_private.ms(c.purge_at),
    'messages', '[]'::jsonb,
    'exchanges', c.exchanges,
    'unread', c.unread,
    'notify', c.notify,
    'sound', c.sound,
    'trustLevel', c.trust_level,
    'levelChangedAt', ally_private.ms(c.level_changed_at),
    'pausedReason', c.paused_reason,
    'lastCtxDay', c.last_ctx_day
  )
$$;

create or replace function ally_private.message_json(m public.messages) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', m.id, 'who', m.who, 'text', m.text, 'at', ally_private.ms(m.created_at),
                            'meta', m.meta, 'inReplyTo', m.in_reply_to)
$$;

-- As P3's, plus the consent version so the client can ask for the v2-live consent.
create or replace function public.get_my_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.session_uid();
  v_ledger jsonb;
begin
  perform ally_private.purge_parted(v_uid);
  perform ally_private.lock_ledger(v_uid);
  v_ledger := ally_private.ledger_json(v_uid);
  return jsonb_build_object(
    'server_now', ally_private.ms(now()),
    'companions', coalesce((select jsonb_agg(ally_private.companion_json(c) order by c.created_at, c.id)
                            from public.companions c where c.user_id = v_uid), '[]'::jsonb),
    'messages_by_companion', coalesce((select jsonb_object_agg(x.companion_id, x.msgs) from (
                                         select m.companion_id, jsonb_agg(ally_private.message_json(m) order by m.created_at, m.id) as msgs
                                         from public.messages m where m.user_id = v_uid group by m.companion_id) x), '{}'::jsonb),
    'ledger', v_ledger,
    'unlocks', v_ledger -> 'unlocks',
    'passes', v_ledger -> 'passes',
    'parted', v_ledger -> 'parted',
    'profile', (select jsonb_build_object('display_name', p.display_name) from public.profiles p where p.id = v_uid),
    'consent', (select jsonb_build_object('granted_at', ally_private.ms(c.granted_at), 'marketing', c.marketing, 'version', c.version)
                from public.consents c where c.user_id = v_uid order by c.granted_at desc, c.id desc limit 1)
  );
end $$;

-- ---------------------------------------------------------------------------
-- D5: replies for live companions are written by the server only.
-- ---------------------------------------------------------------------------
create or replace function public.receive_reply(companion_id text, body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_c public.companions;
  v_msg public.messages;
begin
  v_c := ally_private.own_companion(v_uid, receive_reply.companion_id, true);
  if ally_private.is_live(v_c) then
    raise exception 'live_companion' using errcode = '22023';
  end if;
  insert into public.messages (companion_id, user_id, who, text)
    values (v_c.id, v_uid, 'them', receive_reply.body) returning * into v_msg;
  update public.companions c set unread = c.unread + 1 where c.id = v_c.id returning * into v_c;
  return jsonb_build_object('message', ally_private.message_json(v_msg), 'unread', v_c.unread);
end $$;

create or replace function public.seed_opener(companion_id text, body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_c public.companions;
  v_msg public.messages;
begin
  v_c := ally_private.own_companion(v_uid, seed_opener.companion_id, true);
  if ally_private.is_live(v_c) then
    raise exception 'live_companion' using errcode = '22023';
  end if;
  if exists (select 1 from public.messages m where m.companion_id = v_c.id) then
    return jsonb_build_object('message', null, 'unread', v_c.unread);
  end if;
  insert into public.messages (companion_id, user_id, who, text)
    values (v_c.id, v_uid, 'them', seed_opener.body) returning * into v_msg;
  update public.companions c set unread = c.unread + 1 where c.id = v_c.id returning * into v_c;
  return jsonb_build_object('message', ally_private.message_json(v_msg), 'unread', v_c.unread);
end $$;

-- ---------------------------------------------------------------------------
-- Context card and age check
-- ---------------------------------------------------------------------------
create function public.mark_ctx_shown(companion_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_c public.companions;
begin
  v_c := ally_private.own_companion(v_uid, mark_ctx_shown.companion_id, true);
  update public.companions c set last_ctx_day = public.ist_day_key(now()) where c.id = v_c.id;
end $$;

-- Clears an age_check pause when the re-entered date of birth is 18 or over.
-- Under 18 raises under_18 and leaves the pause in place (the client then
-- runs the existing blocked flow, which purges the anonymous user).
create function public.clear_age_check(companion_id text, dob date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_c public.companions;
begin
  v_c := ally_private.own_companion(v_uid, clear_age_check.companion_id, true);
  if clear_age_check.dob is null or clear_age_check.dob > (now() at time zone 'Asia/Kolkata')::date
     or clear_age_check.dob < date '1900-01-01' then
    raise exception 'invalid_dob' using errcode = '22023';
  end if;
  if age((now() at time zone 'Asia/Kolkata')::date, clear_age_check.dob) < interval '18 years' then
    raise exception 'under_18' using errcode = '22023';
  end if;
  update public.companions c set paused_reason = null where c.id = v_c.id;
  return jsonb_build_object('pausedReason', null);
end $$;

revoke execute on function public.mark_ctx_shown(text), public.clear_age_check(text, date) from public, anon;
grant execute on function public.mark_ctx_shown(text), public.clear_age_check(text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- write_live_reply: one transaction per reply (spec 4.3 step 7). Called by
-- app/api/chat/reply with the service-role client only. The payload is built
-- by the route after sanitize(), safety and trust have run.
--   { companionId, userMessageId|null, reaction|null, userSafety,
--     bubbles: [{ text, meta }], trust: {...}|null, day: {...}|null,
--     safetyUntilMs|null, pausedReason|null, events: [kind] }
-- ---------------------------------------------------------------------------
create function ally_private.write_live_reply(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_c public.companions;
  v_id text := p->>'companionId';
  v_umsg bigint := nullif(p->>'userMessageId', '')::bigint;
  v_b jsonb;
  v_msg public.messages;
  v_out jsonb := '[]'::jsonb;
  v_n int := 0;
  -- A JSON null is not SQL null: normalise so "no trust update" really skips it.
  v_t jsonb := nullif(p->'trust', 'null'::jsonb);
  v_d jsonb := nullif(p->'day', 'null'::jsonb);
  v_kind text;
begin
  select * into v_c from public.companions where id = v_id for update;
  -- Edge case 6: a companion parted mid-request discards the reply.
  if not found or v_c.status <> 'active' then
    return jsonb_build_object('discarded', true, 'bubbles', '[]'::jsonb);
  end if;

  if v_umsg is not null then
    if p->>'reaction' is not null then
      update public.messages m set meta = jsonb_set(m.meta, '{reaction}', to_jsonb(p->>'reaction'))
        where m.id = v_umsg and m.companion_id = v_c.id and m.who = 'me';
    end if;
    if coalesce((p->>'userSafety')::boolean, false) then
      update public.messages m set meta = jsonb_set(m.meta, '{safety}', 'true'::jsonb)
        where m.id = v_umsg and m.companion_id = v_c.id and m.who = 'me';
    end if;
  end if;

  for v_b in select * from jsonb_array_elements(coalesce(p->'bubbles', '[]'::jsonb)) loop
    insert into public.messages (companion_id, user_id, who, text, meta, in_reply_to)
      values (v_c.id, v_c.user_id, 'them', v_b->>'text', coalesce(v_b->'meta', '{}'::jsonb), v_umsg)
      returning * into v_msg;
    v_n := v_n + 1;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_msg.id, 'text', v_msg.text, 'meta', v_msg.meta, 'at', ally_private.ms(v_msg.created_at)));
  end loop;

  update public.companions c set
      unread = c.unread + v_n,
      trust_level = coalesce((v_t->>'level')::int, c.trust_level),
      highest_level = coalesce((v_t->>'highestLevel')::int, c.highest_level),
      trust_points = coalesce((v_t->>'points')::int, c.trust_points),
      level_changed_at = case when v_t is null then c.level_changed_at
                              else case when v_t->>'levelChangedAt' is null then null else to_timestamp((v_t->>'levelChangedAt')::bigint / 1000.0) end end,
      last_drop_at = case when v_t is null then c.last_drop_at
                          else case when v_t->>'lastDropAt' is null then null else to_timestamp((v_t->>'lastDropAt')::bigint / 1000.0) end end,
      below_since = case when v_t is null then c.below_since else v_t->>'belowSince' end,
      signal_since_level = coalesce((v_t->>'signalSinceLevel')::boolean, c.signal_since_level),
      cool_off_until = case when v_t is null then c.cool_off_until
                            else case when v_t->>'coolOffUntil' is null then null else to_timestamp((v_t->>'coolOffUntil')::bigint / 1000.0) end end,
      trust_frozen_until = case when v_t is null then c.trust_frozen_until
                                else case when v_t->>'trustFrozenUntil' is null then null else to_timestamp((v_t->>'trustFrozenUntil')::bigint / 1000.0) end end,
      safety_until = case when p->>'safetyUntilMs' is null then c.safety_until
                          else greatest(coalesce(c.safety_until, to_timestamp(0)), to_timestamp((p->>'safetyUntilMs')::bigint / 1000.0)) end,
      paused_reason = coalesce(p->>'pausedReason', c.paused_reason)
    where c.id = v_c.id;

  if v_d is not null then
    insert into public.trust_days (companion_id, user_id, day, msg_points, session_bonus, disclosure_bonus, user_msgs)
      values (v_c.id, v_c.user_id, v_d->>'key', (v_d->>'msgPoints')::int, (v_d->>'sessionBonus')::boolean,
              (v_d->>'disclosureBonus')::boolean, (v_d->>'userMsgs')::int)
      on conflict (companion_id, day) do update set
        msg_points = excluded.msg_points, session_bonus = excluded.session_bonus,
        disclosure_bonus = excluded.disclosure_bonus, user_msgs = excluded.user_msgs;
  end if;

  for v_kind in select jsonb_array_elements_text(coalesce(p->'events', '[]'::jsonb)) loop
    insert into public.safety_events (user_id, companion_id, kind) values (v_c.user_id, v_c.id, v_kind);
  end loop;

  return jsonb_build_object('discarded', false, 'bubbles', v_out);
end $$;

-- ally_private is not exposed through the API, so the route calls this
-- wrapper with the service-role key. Nobody else may execute it.
create function public.write_live_reply(p jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select ally_private.write_live_reply(p)
$$;
revoke execute on function public.write_live_reply(jsonb) from public, anon, authenticated;
grant execute on function public.write_live_reply(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- trust_decay(): daily, mirrors decay() in src/lib/trust.ts
-- ---------------------------------------------------------------------------
create function ally_private.trust_decay() returns void
language plpgsql set search_path = '' as $$
declare
  r public.companions;
  v_today text := public.ist_day_key(now());
  v_last timestamptz;
  v_points int;
  v_level int;
  v_threshold int;
  v_below text;
  v_drop timestamptz;
  v_changed timestamptz;
begin
  for r in select * from public.companions c where c.status = 'active' and ally_private.is_live(c) for update loop
    select coalesce(max(m.created_at), r.created_at) into v_last from public.messages m where m.companion_id = r.id and m.who = 'me';
    v_points := r.trust_points;
    v_level := r.trust_level;
    v_below := r.below_since;
    v_drop := r.last_drop_at;
    v_changed := r.level_changed_at;

    if (v_today::date - public.ist_day_key(v_last)::date) >= 5 then
      v_points := greatest(0, v_points - 5);
    end if;

    v_threshold := case v_level when 2 then 40 when 3 then 150 when 4 then 330 when 5 then 560 when 6 then 840 else 0 end;
    if v_points < v_threshold and v_below is null then v_below := v_today; end if;
    if v_points >= v_threshold then v_below := null; end if;

    if v_below is not null and v_level > 1
       and (v_today::date - v_below::date) >= 7
       and (v_drop is null or v_drop <= now() - interval '7 days') then
      v_level := v_level - 1;
      v_drop := now();
      v_changed := now();
      v_below := null;
    end if;

    update public.companions c set trust_points = v_points, trust_level = v_level, below_since = v_below,
        last_drop_at = v_drop, level_changed_at = v_changed
      where c.id = r.id
        and (c.trust_points, c.trust_level, c.below_since) is distinct from (v_points, v_level, v_below);
  end loop;
end $$;

-- Service-role wrapper so the RLS suite can run the decay pass on demand.
create function public.run_trust_decay() returns void
language sql security definer set search_path = '' as $$
  select ally_private.trust_decay()
$$;
revoke execute on function public.run_trust_decay() from public, anon, authenticated;
grant execute on function public.run_trust_decay() to service_role;

-- ---------------------------------------------------------------------------
-- Cron. pg_net posts to the site with the bearer secret held in Supabase
-- Vault (`cron_secret`, `site_url`). Where either secret is absent (local,
-- staging) the ping does nothing, so jobs only ever reach Production.
-- ---------------------------------------------------------------------------
create extension if not exists pg_net;

create function ally_private.vault_ping(p_job text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'site_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/cron/vault?job=' || p_job,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
end $$;

revoke all on all functions in schema ally_private from public, anon, authenticated;

-- 00:10 to 02:00 IST is 18:40 to 20:30 UTC, every 10 minutes (three jobs: one
-- cron expression cannot span the hour boundaries).
select cron.schedule('vault-daily-18', '40-59/10 18 * * *', $$ select ally_private.vault_ping('daily') $$);
select cron.schedule('vault-daily-19', '*/10 19 * * *', $$ select ally_private.vault_ping('daily') $$);
select cron.schedule('vault-daily-20', '0-30/10 20 * * *', $$ select ally_private.vault_ping('daily') $$);
-- Sundays 20:40 and 20:50 UTC, after that night's daily run.
select cron.schedule('vault-weekly', '40,50 20 * * 0', $$ select ally_private.vault_ping('weekly') $$);
-- 00:05 IST daily.
select cron.schedule('trust-decay', '35 18 * * *', $$ select ally_private.trust_decay() $$);

-- ---------------------------------------------------------------------------
-- Admin (read-only): trust state per companion and 30-day safety counts.
-- As P3's admin_get_user, with two additions.
-- ---------------------------------------------------------------------------
create or replace function public.admin_get_user(target uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform ally_private.require_admin();
  perform ally_private.require_user(admin_get_user.target);
  return ally_private.admin_user_json(admin_get_user.target) || jsonb_build_object(
    'limits', (select jsonb_build_object('free_daily_override', ul.free_daily_override, 'pass_cap_override', ul.pass_cap_override,
                                         'updated_at', ul.updated_at, 'updated_by', ul.updated_by)
               from public.user_limits ul where ul.user_id = admin_get_user.target),
    'defaults', jsonb_build_object('free_daily', ally_private.free_daily(), 'pass_cap', ally_private.pass_cap(),
                                   'pass_hours', ally_private.pass_hours(), 'max_companions', ally_private.max_companions()),
    'companions', coalesce((select jsonb_agg(jsonb_build_object(
                              'id', c.id, 'template_id', c.template_id, 'deck_gender', c.deck_gender, 'status', c.status,
                              'exchanges', c.exchanges,
                              'message_count', (select count(*) from public.messages m where m.companion_id = c.id),
                              'created_at', c.created_at, 'last_opened_at', c.last_opened_at, 'parted_at', c.parted_at,
                              'live', ally_private.is_live(c),
                              'trust_level', c.trust_level, 'highest_level', c.highest_level, 'trust_points', c.trust_points,
                              'relationship_day', (public.ist_day_key(now())::date - public.ist_day_key(c.created_at)::date))
                              order by c.created_at, c.id)
                            from public.companions c where c.user_id = admin_get_user.target), '[]'::jsonb),
    'safety_counts', coalesce((select jsonb_object_agg(x.kind, x.n) from (
                                 select s.kind, count(*) as n from public.safety_events s
                                 where s.user_id = admin_get_user.target and s.created_at > now() - interval '30 days'
                                 group by s.kind) x), '{}'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', a.id, 'action', a.action, 'actor_id', a.actor_id, 'actor_email', au.email,
                         'old_value', a.old_value, 'new_value', a.new_value, 'created_at', a.created_at) order by a.id desc)
                       from (select * from public.admin_audit x where x.target_user_id = admin_get_user.target
                             order by x.id desc limit 20) a
                       left join auth.users au on au.id = a.actor_id), '[]'::jsonb)
  );
end $$;
