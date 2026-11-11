-- Plans and trial: a 7-day free trial, then a paid Google Play subscription
-- (Pro, Max, Ultra). Replaces the day pass and the one-time slot unlocks.
--
-- Server side only. Native Play Billing is wired later: the single entry point
-- for a verified purchase is public.set_subscription(), executable by
-- service_role only. The client never decides what plan a user is on.
--
-- Everything here is `create or replace` / additive over earlier migrations so
-- the applied ones stay untouched. NOT applied to staging or prod by this change.
--
-- Constants below mirror src/lib/config.ts (PLAN_CONFIG);
-- tests/unit/sqlConstants.test.ts fails if either side changes alone.

-- ---------------------------------------------------------------------------
-- Constants
-- ---------------------------------------------------------------------------
-- ally_private.free_daily() (100) already exists and is the trial's daily chat allowance.
create function ally_private.trial_days()        returns int language sql immutable set search_path = '' as $$ select 7 $$;
create function ally_private.slots_trial()       returns int language sql immutable set search_path = '' as $$ select 1 $$;
create function ally_private.slots_pro()         returns int language sql immutable set search_path = '' as $$ select 1 $$;
create function ally_private.slots_max()         returns int language sql immutable set search_path = '' as $$ select 2 $$;
create function ally_private.slots_ultra()       returns int language sql immutable set search_path = '' as $$ select 4 $$;
-- Hidden daily fair-use caps. Never sent to the client.
create function ally_private.cap_pro()           returns int language sql immutable set search_path = '' as $$ select 300 $$;
create function ally_private.cap_max()           returns int language sql immutable set search_path = '' as $$ select 400 $$;
create function ally_private.cap_ultra()         returns int language sql immutable set search_path = '' as $$ select 400 $$;
create function ally_private.max_level_default() returns int language sql immutable set search_path = '' as $$ select 5 $$;
create function ally_private.max_level_ultra()   returns int language sql immutable set search_path = '' as $$ select 6 $$;
-- Display prices, INR a month, GST inclusive. Mirrored so the two sides cannot drift.
create function ally_private.price_pro()         returns int language sql immutable set search_path = '' as $$ select 299 $$;
create function ally_private.price_max()         returns int language sql immutable set search_path = '' as $$ select 499 $$;
create function ally_private.price_ultra()       returns int language sql immutable set search_path = '' as $$ select 799 $$;

-- ---------------------------------------------------------------------------
-- Tables and columns
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  plan           text not null check (plan in ('pro', 'max', 'ultra')),
  status         text not null check (status in ('active', 'cancelled', 'expired')),
  expires_at     timestamptz,
  purchase_token text,
  product_id     text,
  updated_at     timestamptz not null default now()
);
-- One Play purchase token can belong to one user only.
create unique index subscriptions_purchase_token_key on public.subscriptions (purchase_token) where purchase_token is not null;
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

alter table public.subscriptions enable row level security;
create policy subscriptions_select_own on public.subscriptions for select to authenticated using (user_id = (select auth.uid()));
-- Owner-only SELECT, and no direct INSERT/UPDATE/DELETE for any client role.
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;
grant select, insert, update, delete on public.subscriptions to service_role;

-- trial_started_at: when the 7 days began. plan_forced: set by admin_set_plan so
-- an admin can test a plan on their own account (admins otherwise bypass all limits).
alter table public.profiles
  add column trial_started_at timestamptz,
  add column plan_forced boolean not null default false;
-- Existing non-admin users get a fresh 7 days from now; admins keep their creation time.
update public.profiles set trial_started_at = case when role = 'admin' then created_at else now() end;
alter table public.profiles
  alter column trial_started_at set not null,
  alter column trial_started_at set default now();

-- Once-per-companion "deeper level" banner.
alter table public.companions add column deeper_prompt_shown boolean not null default false;

-- DEPRECATED, drop in a later migration: the day pass and one-time slot unlocks are gone.
comment on table public.ledger_unlocks is 'DEPRECATED, drop in a later migration';
comment on table public.ledger_passes  is 'DEPRECATED, drop in a later migration';
comment on column public.ledgers.slots_unlocked  is 'DEPRECATED, drop in a later migration';
comment on column public.ledgers.pass_started_at is 'DEPRECATED, drop in a later migration';
comment on column public.ledgers.pass_ends_at    is 'DEPRECATED, drop in a later migration';
comment on column public.ledgers.pass_used       is 'DEPRECATED, drop in a later migration';

-- ---------------------------------------------------------------------------
-- effective_plan(uid): trial | expired | pro | max | ultra
--   * a subscription that is active (or cancelled) with expires_at > now() gives its plan;
--   * otherwise a user inside 7 days of trial_started_at is on the trial;
--   * otherwise expired.
-- service_role only: the client reads its own result through get_entitlement().
-- ---------------------------------------------------------------------------
create function public.effective_plan(p_user_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.plan from public.subscriptions s
      where s.user_id = p_user_id and s.status in ('active', 'cancelled') and s.expires_at > now()),
    (select 'trial' from public.profiles p
      where p.id = p_user_id and now() < p.trial_started_at + make_interval(days => ally_private.trial_days())),
    'expired')
$$;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------
-- Admins bypass every limit unless they forced a plan on themselves (admin_set_plan).
create function ally_private.is_bypass(p_uid uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_uid and p.role = 'admin' and not p.plan_forced)
$$;

-- The plan the limits are judged on (a bypassing admin counts as Ultra).
create function ally_private.plan_for(p_uid uuid) returns text
language sql stable set search_path = '' as $$
  select case when ally_private.is_bypass(p_uid) then 'ultra' else public.effective_plan(p_uid) end
$$;

create function ally_private.slot_limit_for(p_uid uuid) returns int
language sql stable set search_path = '' as $$
  select case
    when ally_private.is_bypass(p_uid) then 99
    else case public.effective_plan(p_uid)
      when 'trial' then ally_private.slots_trial()
      when 'pro' then ally_private.slots_pro()
      when 'max' then ally_private.slots_max()
      when 'ultra' then ally_private.slots_ultra()
      else 0 end
  end
$$;

create function ally_private.max_level_for(p_uid uuid) returns int
language sql stable set search_path = '' as $$
  select case when ally_private.plan_for(p_uid) = 'ultra' then ally_private.max_level_ultra() else ally_private.max_level_default() end
$$;

-- The daily chat ceiling for a plan: the visible 100 on the trial, the hidden
-- fair-use cap on a paid plan. An admin override (user_limits) wins.
create function ally_private.daily_cap_for(p_uid uuid, p_plan text) returns int
language sql stable set search_path = '' as $$
  select case p_plan
    when 'trial' then ally_private.free_daily_for(p_uid)
    when 'pro' then coalesce((select ul.pass_cap_override from public.user_limits ul where ul.user_id = p_uid), ally_private.cap_pro())
    when 'max' then coalesce((select ul.pass_cap_override from public.user_limits ul where ul.user_id = p_uid), ally_private.cap_max())
    when 'ultra' then coalesce((select ul.pass_cap_override from public.user_limits ul where ul.user_id = p_uid), ally_private.cap_ultra())
    else 0
  end
$$;

-- The entitlement the client sees. chats_left_today is set on the trial only,
-- so a paid plan's hidden cap is never exposed. Reads the ledger as it stands
-- (call after lock_ledger() inside a write path so the day has rolled).
create function ally_private.entitlement_for(p_uid uuid) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  v_bypass boolean := ally_private.is_bypass(p_uid);
  v_plan text := case when v_bypass then 'ultra' else public.effective_plan(p_uid) end;
  v_start timestamptz;
  v_used int;
  v_cap int := ally_private.daily_cap_for(p_uid, v_plan);
  v_can boolean;
begin
  select p.trial_started_at into v_start from public.profiles p where p.id = p_uid;
  select case when l.day = public.ist_day_key(now()) then l.free_used else 0 end into v_used
    from public.ledgers l where l.user_id = p_uid;
  v_used := coalesce(v_used, 0);
  v_can := v_bypass or (v_plan <> 'expired' and v_used < v_cap);
  return jsonb_build_object(
    'plan', v_plan,
    'trial_ends_at', case when v_plan = 'trial' then ally_private.ms(v_start + make_interval(days => ally_private.trial_days())) end,
    'trial_day', case when v_plan = 'trial'
                      then least(ally_private.trial_days(), floor(extract(epoch from (now() - v_start)) / 86400)::int + 1) end,
    'slot_limit', ally_private.slot_limit_for(p_uid),
    'max_level', ally_private.max_level_for(p_uid),
    'can_send', v_can,
    'chats_left_today', case when v_plan = 'trial' and not v_bypass then greatest(0, v_cap - v_used) end,
    'cap_reached', (not v_bypass) and v_plan <> 'expired' and v_used >= v_cap
  );
end $$;

-- A companion is locked (visible, history readable, no new messages) when it
-- is active but not among the first slot_limit active companions by creation.
create function ally_private.companion_locked(c public.companions) returns boolean
language sql stable set search_path = '' as $$
  select c.status = 'active' and (
    select count(*) from public.companions o
    where o.user_id = c.user_id and o.status = 'active' and (o.created_at, o.id) < (c.created_at, c.id)
  ) >= ally_private.slot_limit_for(c.user_id)
$$;

-- ---------------------------------------------------------------------------
-- Client JSON
-- ---------------------------------------------------------------------------
-- The ledger is now just the day's counter and the faces that were parted.
create or replace function ally_private.ledger_json(p_uid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'day', l.day,
    'freeUsed', l.free_used,
    'parted', coalesce((select jsonb_agg(t.template_id order by t.template_id)
                        from public.ledger_parted t where t.user_id = p_uid), '[]'::jsonb)
  )
  from public.ledgers l where l.user_id = p_uid
$$;

-- As noor_live's, with the trust level clamped to the plan's ceiling. The stored
-- progress is untouched; deeperLevelAvailable says there is more behind the clamp.
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
    'trustLevel', least(c.trust_level, ally_private.max_level_for(c.user_id)),
    'deeperLevelAvailable', c.trust_level > ally_private.max_level_for(c.user_id),
    'deeperShown', c.deeper_prompt_shown,
    'levelChangedAt', ally_private.ms(c.level_changed_at),
    'pausedReason', c.paused_reason,
    'lastCtxDay', c.last_ctx_day,
    'live', ally_private.is_live(c)
  )
$$;

-- ---------------------------------------------------------------------------
-- get_entitlement(), and the one-call boot state
-- ---------------------------------------------------------------------------
create function public.get_entitlement() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.session_uid();
begin
  perform ally_private.lock_ledger(v_uid);
  return ally_private.entitlement_for(v_uid);
end $$;

-- As live_chat's, with the entitlement folded in and the unlocks/passes keys gone.
create or replace function public.get_my_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.session_uid();
begin
  perform ally_private.purge_parted(v_uid);
  perform ally_private.lock_ledger(v_uid);
  return jsonb_build_object(
    'server_now', ally_private.ms(now()),
    'companions', coalesce((select jsonb_agg(ally_private.companion_json(c) order by c.created_at, c.id)
                            from public.companions c where c.user_id = v_uid), '[]'::jsonb),
    'messages_by_companion', coalesce((select jsonb_object_agg(x.companion_id, x.msgs) from (
                                         select m.companion_id, jsonb_agg(ally_private.message_json(m) order by m.created_at, m.id) as msgs
                                         from public.messages m where m.user_id = v_uid group by m.companion_id) x), '{}'::jsonb),
    'ledger', ally_private.ledger_json(v_uid),
    'entitlement', ally_private.entitlement_for(v_uid),
    'profile', (select jsonb_build_object('display_name', p.display_name) from public.profiles p where p.id = v_uid),
    'consent', (select jsonb_build_object('granted_at', ally_private.ms(c.granted_at), 'marketing', c.marketing, 'version', c.version)
                from public.consents c where c.user_id = v_uid order by c.granted_at desc, c.id desc limit 1)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Enforcement
-- ---------------------------------------------------------------------------
-- send_message: one counter (ledgers.free_used, rolled at the IST day boundary by
-- lock_ledger) judged against the plan's ceiling. A blocked send returns
-- blocked=true with status = code, so the client also gets the fresh entitlement:
--   PLAN_EXPIRED     trial over, no plan
--   COMPANION_LOCKED the companion is outside the active slots of the plan
--   TRIAL_LIMIT      the trial's 100 chats for today are used
--   FAIR_USE_CAP     a paid plan's hidden daily cap is reached
create or replace function public.send_message(companion_id text, body text, reply_to bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_c public.companions;
  v_ent jsonb;
  v_code text;
  v_msg public.messages;
  v_q bigint;
begin
  if nullif(btrim(coalesce(send_message.body, '')), '') is null then
    raise exception 'empty_message' using errcode = '22023';
  end if;
  perform ally_private.lock_ledger(v_uid);
  v_c := ally_private.own_companion(v_uid, send_message.companion_id, true);
  v_ent := ally_private.entitlement_for(v_uid);
  v_code := case
    when v_ent->>'plan' = 'expired' then 'PLAN_EXPIRED'
    when ally_private.companion_locked(v_c) then 'COMPANION_LOCKED'
    when not (v_ent->>'can_send')::boolean then case when v_ent->>'plan' = 'trial' then 'TRIAL_LIMIT' else 'FAIR_USE_CAP' end
  end;
  if v_code is not null then
    return jsonb_build_object('blocked', true, 'status', v_code, 'code', v_code, 'message', null,
                              'exchanges', v_c.exchanges, 'ledger', ally_private.ledger_json(v_uid), 'entitlement', v_ent);
  end if;

  -- A reply must point at a live message in this same conversation.
  if send_message.reply_to is not null then
    select m.id into v_q from public.messages m
      where m.id = send_message.reply_to and m.companion_id = v_c.id and m.deleted_at is null;
    if v_q is null then
      raise exception 'quote_not_found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.messages (companion_id, user_id, who, text, meta)
    values (v_c.id, v_uid, 'me', send_message.body,
            case when v_q is null then '{}'::jsonb else jsonb_build_object('quoteId', v_q) end)
    returning * into v_msg;
  update public.companions c set exchanges = c.exchanges + 1 where c.id = v_c.id returning * into v_c;
  update public.ledgers l set free_used = l.free_used + 1 where l.user_id = v_uid;

  return jsonb_build_object('blocked', false, 'status', 'ok', 'code', null, 'message', ally_private.message_json(v_msg),
                            'exchanges', v_c.exchanges, 'ledger', ally_private.ledger_json(v_uid),
                            'entitlement', ally_private.entitlement_for(v_uid));
end $$;

-- create_companion: active companions may not exceed the plan's slot limit
-- (parted ones do not count). Error code SLOT_LIMIT.
create or replace function public.create_companion(template_id text, deck_gender text, answers jsonb, core jsonb, display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_active int;
  v_ms bigint;
  v_row public.companions;
begin
  perform ally_private.lock_ledger(v_uid);
  select count(*) into v_active from public.companions c where c.user_id = v_uid and c.status = 'active';
  if v_active >= ally_private.slot_limit_for(v_uid) then
    raise exception 'SLOT_LIMIT' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.companions c
             where c.user_id = v_uid and c.status = 'active' and c.template_id = create_companion.template_id)
     or exists (select 1 from public.ledger_parted p
                where p.user_id = v_uid and p.template_id = create_companion.template_id) then
    raise exception 'template_unavailable' using errcode = 'P0001';
  end if;

  -- 'c_' + base36 epoch ms, the client's existing id format. Ids are global,
  -- so step forward a millisecond on the rare collision.
  v_ms := ally_private.ms(clock_timestamp());
  loop
    begin
      insert into public.companions (id, user_id, template_id, deck_gender, answers, core)
      values ('c_' || ally_private.base36(v_ms), v_uid, create_companion.template_id, create_companion.deck_gender,
              coalesce(create_companion.answers, ally_private.empty_answers()), coalesce(create_companion.core, ally_private.empty_core()))
      returning * into v_row;
      exit;
    exception when unique_violation then
      v_ms := v_ms + 1;
    end;
  end loop;

  -- An invalid name is skipped, never raised: companion creation must not fail on it.
  if ally_private.valid_display_name(create_companion.display_name) then
    update public.profiles p set display_name = btrim(create_companion.display_name)
      where p.id = v_uid and (p.display_name is null or p.display_name = '');
  end if;

  return ally_private.companion_json(v_row);
end $$;

-- part_companion: as P2's, also returning the entitlement (a freed slot unlocks
-- the next paused companion).
create or replace function public.part_companion(companion_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_c public.companions;
begin
  perform ally_private.lock_ledger(v_uid);
  v_c := ally_private.own_companion(v_uid, part_companion.companion_id, false);
  if v_c.status = 'active' then
    update public.companions c
      set status = 'parted', parted_at = now(), purge_at = now() + make_interval(days => ally_private.part_purge_days())
      where c.id = v_c.id returning * into v_c;
    insert into public.ledger_parted (user_id, template_id) values (v_uid, v_c.template_id)
      on conflict do nothing;
  end if;
  return jsonb_build_object('partedAt', ally_private.ms(v_c.parted_at), 'purgeAt', ally_private.ms(v_c.purge_at),
                            'ledger', ally_private.ledger_json(v_uid), 'entitlement', ally_private.entitlement_for(v_uid));
end $$;

-- QA refill: zero today's counter.
create or replace function public.qa_refill_messages()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_qa();
begin
  perform ally_private.lock_ledger(v_uid);
  update public.ledgers l set free_used = 0 where l.user_id = v_uid;
  return jsonb_build_object('ledger', ally_private.ledger_json(v_uid), 'entitlement', ally_private.entitlement_for(v_uid));
end $$;

-- Logging in from an anonymous session: companions move into the account being
-- logged into until its slot limit is reached.
create or replace function ally_private.merge_anonymous(p_anon uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_c record;
  v_active int;
  v_limit int;
  v_moved text[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  v_anon_name text;
begin
  if p_anon is null or p_target is null or p_anon = p_target then
    raise exception 'invalid_merge' using errcode = '22023';
  end if;

  perform ally_private.lock_ledger(least(p_anon, p_target));
  perform ally_private.lock_ledger(greatest(p_anon, p_target));

  v_limit := ally_private.slot_limit_for(p_target);
  select count(*) into v_active from public.companions c where c.user_id = p_target and c.status = 'active';

  for v_c in
    select c.id, c.template_id
    from public.companions c
    where c.user_id = p_anon and c.status = 'active'
    order by c.last_opened_at desc, c.created_at desc
  loop
    if exists (select 1 from public.companions t where t.user_id = p_target and t.template_id = v_c.template_id)
       or exists (select 1 from public.ledger_parted p where p.user_id = p_target and p.template_id = v_c.template_id) then
      v_skipped := v_skipped || jsonb_build_object('id', v_c.id, 'reason', 'duplicate');
    elsif v_active >= v_limit then
      v_skipped := v_skipped || jsonb_build_object('id', v_c.id, 'reason', 'full');
    else
      update public.companions set user_id = p_target where id = v_c.id;
      update public.messages set user_id = p_target where companion_id = v_c.id;
      update public.trust_days set user_id = p_target where companion_id = v_c.id;
      update public.memory_facts set user_id = p_target where companion_id = v_c.id;
      update public.memory_summaries set user_id = p_target where companion_id = v_c.id;
      update public.safety_events set user_id = p_target where companion_id = v_c.id;
      v_active := v_active + 1;
      v_moved := v_moved || v_c.id;
    end if;
  end loop;

  select p.display_name into v_anon_name from public.profiles p where p.id = p_anon;
  if ally_private.valid_display_name(v_anon_name) then
    update public.profiles p set display_name = btrim(v_anon_name)
      where p.id = p_target and (p.display_name is null or btrim(p.display_name) = '');
  end if;

  return jsonb_build_object('moved', to_jsonb(v_moved), 'skipped', v_skipped);
end $$;

-- ---------------------------------------------------------------------------
-- Reading helpers for the server-side reply route (service_role only): the
-- trust ceiling for the owner's plan, and whether the companion is paused.
-- ---------------------------------------------------------------------------
create function public.reply_gate(p_companion_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.companions;
begin
  select * into c from public.companions where id = p_companion_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object('max_level', ally_private.max_level_for(c.user_id), 'locked', ally_private.companion_locked(c));
end $$;

-- The "deeper level" banner has been shown for this companion.
create function public.mark_deeper_shown(companion_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_c public.companions;
begin
  v_c := ally_private.own_companion(v_uid, mark_deeper_shown.companion_id, false);
  update public.companions c set deeper_prompt_shown = true where c.id = v_c.id;
end $$;

-- ---------------------------------------------------------------------------
-- set_subscription: the single entry point for a verified purchase.
--
-- EXPECTED CALLER: the server-side Google Play purchase verification and the
-- Real-time Developer Notifications handler (Babu), using the service role key.
-- It must have verified the purchase token with the Play Developer API first.
--   p_plan        'pro' | 'max' | 'ultra' (from the verified productId)
--   p_status      'active' | 'cancelled' | 'expired'
--   p_expires_at  the end of the paid period (required unless p_status = 'expired')
--   p_purchase_token / p_product_id  as returned by Play, stored for support
-- Idempotent: calling it again for the same user replaces the row. EXECUTE is
-- granted to service_role only; clients cannot reach it.
-- ---------------------------------------------------------------------------
create function public.set_subscription(p_user_id uuid, p_plan text, p_status text, p_expires_at timestamptz,
                                        p_purchase_token text, p_product_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_plan is null or p_plan not in ('pro', 'max', 'ultra') then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('active', 'cancelled', 'expired') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if p_status <> 'expired' and p_expires_at is null then
    raise exception 'expires_at_required' using errcode = '22023';
  end if;
  perform ally_private.require_user(p_user_id);
  insert into public.subscriptions as s (user_id, plan, status, expires_at, purchase_token, product_id)
    values (p_user_id, p_plan, p_status, p_expires_at, p_purchase_token, p_product_id)
    on conflict (user_id) do update
      set plan = excluded.plan, status = excluded.status, expires_at = excluded.expires_at,
          purchase_token = excluded.purchase_token, product_id = excluded.product_id;
  return jsonb_build_object('plan', public.effective_plan(p_user_id));
end $$;

-- ---------------------------------------------------------------------------
-- admin_set_plan: QA and admins force a state for testing. Requires is_admin().
--   p_plan_or_state: trial | expired | pro | max | ultra | admin
--   p_trial_day: with 'trial', the day to be on (1 to 8; day 8 is the first expired day)
-- 'admin' hands the account back to the admin bypass (no limits).
-- ---------------------------------------------------------------------------
alter table public.admin_audit drop constraint admin_audit_action_check;
alter table public.admin_audit add constraint admin_audit_action_check check (action in
  ('suspend', 'unsuspend', 'grant_pass', 'end_pass', 'set_slots', 'set_free_daily_override',
   'set_pass_cap_override', 'force_logout', 'set_plan'));

create function public.admin_set_plan(p_user_id uuid, p_plan_or_state text, p_trial_day int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := ally_private.require_admin();
  v_day int := coalesce(p_trial_day, 1);
  v_old text;
begin
  if p_plan_or_state is null or p_plan_or_state not in ('trial', 'expired', 'pro', 'max', 'ultra', 'admin') then
    raise exception 'invalid_plan' using errcode = '22023';
  end if;
  if p_plan_or_state = 'trial' and (v_day < 1 or v_day > 8) then
    raise exception 'invalid_trial_day' using errcode = '22023';
  end if;
  perform ally_private.require_user(p_user_id);
  perform ally_private.lock_ledger(p_user_id);
  v_old := ally_private.plan_for(p_user_id);

  if p_plan_or_state = 'admin' then
    update public.profiles p set plan_forced = false where p.id = p_user_id;
  elsif p_plan_or_state = 'trial' then
    delete from public.subscriptions s where s.user_id = p_user_id;
    update public.profiles p set trial_started_at = now() - make_interval(days => v_day - 1), plan_forced = true where p.id = p_user_id;
  elsif p_plan_or_state = 'expired' then
    delete from public.subscriptions s where s.user_id = p_user_id;
    update public.profiles p set trial_started_at = now() - make_interval(days => ally_private.trial_days() + 23), plan_forced = true where p.id = p_user_id;
  else
    insert into public.subscriptions as s (user_id, plan, status, expires_at, purchase_token, product_id)
      values (p_user_id, p_plan_or_state, 'active', now() + interval '30 days', 'admin:' || p_user_id::text, 'ally_' || p_plan_or_state)
      on conflict (user_id) do update
        set plan = excluded.plan, status = excluded.status, expires_at = excluded.expires_at,
            purchase_token = excluded.purchase_token, product_id = excluded.product_id;
    update public.profiles p set plan_forced = true where p.id = p_user_id;
  end if;

  perform ally_private.audit(v_actor, p_user_id, 'set_plan', jsonb_build_object('plan', v_old),
                             jsonb_build_object('plan', p_plan_or_state, 'trial_day', case when p_plan_or_state = 'trial' then v_day end));
  return jsonb_build_object('changed', v_old is distinct from ally_private.plan_for(p_user_id),
                            'entitlement', ally_private.entitlement_for(p_user_id));
end $$;

-- ---------------------------------------------------------------------------
-- Admin console: the day pass and slot controls are gone. The ledger summary now
-- reports the plan; the per-user overrides stay (free_daily_override applies to
-- the trial, pass_cap_override to a paid plan's hidden cap).
-- ---------------------------------------------------------------------------
create or replace function ally_private.admin_ledger_json(p_uid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'plan', ally_private.plan_for(p_uid),
    'plan_forced', coalesce((select p.plan_forced from public.profiles p where p.id = p_uid), false),
    'trial_ends_at', (select p.trial_started_at + make_interval(days => ally_private.trial_days()) from public.profiles p where p.id = p_uid),
    'slot_limit', ally_private.slot_limit_for(p_uid),
    'free_used', case when l.day = public.ist_day_key(now()) then l.free_used else 0 end,
    'free_daily', ally_private.free_daily_for(p_uid),
    'free_left', greatest(0, ally_private.free_daily_for(p_uid) - case when l.day = public.ist_day_key(now()) then l.free_used else 0 end),
    'fair_use_cap', ally_private.daily_cap_for(p_uid, case ally_private.plan_for(p_uid) when 'pro' then 'pro' when 'max' then 'max' else 'ultra' end)
  )
  from (select p_uid as uid) x left join public.ledgers l on l.user_id = x.uid
$$;

create or replace function public.admin_get_user(target uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform ally_private.require_admin();
  perform ally_private.require_user(admin_get_user.target);
  return ally_private.admin_user_json(admin_get_user.target) || jsonb_build_object(
    'limits', (select jsonb_build_object('free_daily_override', ul.free_daily_override, 'pass_cap_override', ul.pass_cap_override,
                                         'updated_at', ul.updated_at, 'updated_by', ul.updated_by)
               from public.user_limits ul where ul.user_id = admin_get_user.target),
    'defaults', jsonb_build_object('free_daily', ally_private.free_daily(),
                                   'fair_use_cap', ally_private.daily_cap_for(null, case ally_private.plan_for(admin_get_user.target) when 'pro' then 'pro' when 'max' then 'max' else 'ultra' end),
                                   'trial_days', ally_private.trial_days()),
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

-- ---------------------------------------------------------------------------
-- Removed: the day pass and one-time slot unlocks (and the admin controls over them).
-- The tables ledger_unlocks and ledger_passes stay, marked DEPRECATED above.
-- ---------------------------------------------------------------------------
drop function public.unlock_slot(int);
drop function public.buy_pass();
drop function public.admin_set_slots(uuid, int);
drop function public.admin_grant_pass(uuid, int);
drop function public.admin_end_pass(uuid);
drop function ally_private.can_send(public.ledgers);
drop function ally_private.pass_active(public.ledgers);
drop function ally_private.pass_cap_for(uuid);
drop function ally_private.pass_cap();
drop function ally_private.pass_hours();
drop function ally_private.max_companions();
drop function ally_private.price_day_pass();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on all functions in schema ally_private from public, anon, authenticated;

revoke execute on function
  public.get_entitlement(),
  public.mark_deeper_shown(text),
  public.admin_set_plan(uuid, text, int)
  from public, anon;
grant execute on function
  public.get_entitlement(),
  public.mark_deeper_shown(text),
  public.admin_set_plan(uuid, text, int)
  to authenticated;

-- service_role only: nothing a client can call.
revoke execute on function
  public.set_subscription(uuid, text, text, timestamptz, text, text),
  public.effective_plan(uuid),
  public.reply_gate(text)
  from public, anon, authenticated;
grant execute on function
  public.set_subscription(uuid, text, text, timestamptz, text, text),
  public.effective_plan(uuid),
  public.reply_gate(text)
  to service_role;
