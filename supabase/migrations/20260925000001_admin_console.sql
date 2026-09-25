-- P3: admin console (docs/specs/p3-admin-console.md). Two operational
-- tables, the admin_* RPCs behind /admin, and two changes to P2's runtime
-- behaviour, both via `create or replace` so the applied P2 migration stays
-- untouched:
--   * per-user limit overrides (user_limits) now feed can_send() and
--     ledger_json(), so an override actually changes send_message;
--   * a suspended account is refused by every RPC that goes through
--     require_uid(), except the read-only get_my_state.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A row exists only once an admin sets an override; null means "use the
-- global default" (ally_private.free_daily() / pass_cap()).
create table public.user_limits (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  free_daily_override int check (free_daily_override is null or free_daily_override >= 0),
  pass_cap_override   int check (pass_cap_override is null or pass_cap_override >= 0),
  updated_at          timestamptz not null default now(),
  -- set null, not restrict: an admin who once set a limit can still be deleted
  updated_by          uuid references auth.users(id) on delete set null
);

-- Append-only. Rows about a user go with that user (account deletion leaves
-- nothing behind); an actor with audit history can't be deleted until the
-- trail is dealt with by hand, so "who did this" is never silently lost.
create table public.admin_audit (
  id             bigint generated always as identity primary key,
  actor_id       uuid not null references auth.users(id),
  target_user_id uuid not null references auth.users(id) on delete cascade,
  action         text not null check (action in ('suspend', 'unsuspend', 'grant_pass', 'end_pass', 'set_slots',
                                                 'set_free_daily_override', 'set_pass_cap_override', 'force_logout')),
  old_value      jsonb,
  new_value      jsonb,
  created_at     timestamptz not null default now()
);
create index admin_audit_target_idx on public.admin_audit (target_user_id, id desc);
create index admin_audit_actor_idx on public.admin_audit (actor_id);

-- ---------------------------------------------------------------------------
-- RLS and grants. Admins may read both tables; nobody else, not even for
-- their own user_id. No client role may write either: writes happen inside
-- the admin RPCs (and the force-logout route via admin_revoke_sessions).
-- ---------------------------------------------------------------------------
alter table public.user_limits enable row level security;
alter table public.admin_audit enable row level security;

create policy user_limits_admin_select on public.user_limits for select to authenticated using ((select public.is_admin()));
create policy admin_audit_admin_select on public.admin_audit for select to authenticated using ((select public.is_admin()));

revoke all on public.user_limits, public.admin_audit from anon, authenticated;
grant select on public.user_limits, public.admin_audit to authenticated;
grant select, insert, update, delete on public.user_limits, public.admin_audit to service_role;
grant usage, select on sequence public.admin_audit_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Effective limits, and P2's read path updated to use them
-- ---------------------------------------------------------------------------
create function ally_private.free_daily_for(p_uid uuid) returns int
language sql stable set search_path = '' as $$
  select coalesce((select ul.free_daily_override from public.user_limits ul where ul.user_id = p_uid), ally_private.free_daily())
$$;

create function ally_private.pass_cap_for(p_uid uuid) returns int
language sql stable set search_path = '' as $$
  select coalesce((select ul.pass_cap_override from public.user_limits ul where ul.user_id = p_uid), ally_private.pass_cap())
$$;

-- canSend() with the user's effective limits (was: the global constants).
create or replace function ally_private.can_send(l public.ledgers) returns text
language sql stable set search_path = '' as $$
  select case
    when ally_private.pass_active(l) then
      case when coalesce(l.pass_used, 0) < ally_private.pass_cap_for(l.user_id) then 'ok' else 'capped' end
    when ally_private.free_daily_for(l.user_id) - l.free_used > 0 then 'ok'
    else 'empty'
  end
$$;

-- As P2's, plus the effective freeDaily/passCap, so the client's canSend()
-- and "N free messages left" agree with the server under an override.
create or replace function ally_private.ledger_json(p_uid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'slotsUnlocked', l.slots_unlocked,
    'day', l.day,
    'freeUsed', l.free_used,
    'freeDaily', ally_private.free_daily_for(p_uid),
    'passCap', ally_private.pass_cap_for(p_uid),
    'pass', case when l.pass_started_at is null then null else jsonb_build_object(
      'startedAt', ally_private.ms(l.pass_started_at),
      'endsAt', ally_private.ms(l.pass_ends_at),
      'used', coalesce(l.pass_used, 0)) end,
    'unlocks', coalesce((select jsonb_agg(jsonb_build_object('slot', u.slot, 'at', ally_private.ms(u.at), 'amount', u.amount) order by u.id)
                         from public.ledger_unlocks u where u.user_id = p_uid), '[]'::jsonb),
    'passes', coalesce((select jsonb_agg(jsonb_build_object('startedAt', ally_private.ms(p.started_at), 'amount', p.amount) order by p.id)
                        from public.ledger_passes p where p.user_id = p_uid), '[]'::jsonb),
    'parted', coalesce((select jsonb_agg(t.template_id order by t.template_id)
                        from public.ledger_parted t where t.user_id = p_uid), '[]'::jsonb)
  )
  from public.ledgers l where l.user_id = p_uid
$$;

-- ---------------------------------------------------------------------------
-- Suspension. require_uid() is the first line of every P2 RPC, so checking
-- here covers create_companion, send_message, unlock_slot and buy_pass (and
-- the other per-companion writes) in one place. get_my_state switches to the
-- unchecked session_uid() so a suspended user can still load the app and
-- see why their sends fail.
-- ---------------------------------------------------------------------------
create function ally_private.session_uid() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function ally_private.require_uid() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v uuid := ally_private.session_uid();
begin
  if exists (select 1 from public.profiles p where p.id = v and p.status = 'suspended') then
    raise exception 'account_suspended' using errcode = '42501';
  end if;
  return v;
end $$;

-- As P2's, reading the uid with session_uid() instead of require_uid().
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
    'consent', (select jsonb_build_object('granted_at', ally_private.ms(c.granted_at), 'marketing', c.marketing)
                from public.consents c where c.user_id = v_uid order by c.granted_at desc, c.id desc limit 1)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Admin helpers
-- ---------------------------------------------------------------------------

-- The caller's uid if they are an admin (P1's public.is_admin()), else 42501.
create function ally_private.require_admin() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v uuid := auth.uid();
begin
  if v is null or not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return v;
end $$;

create function ally_private.require_user(p_uid uuid) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_uid is null or not exists (select 1 from auth.users u where u.id = p_uid) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
end $$;

create function ally_private.audit(p_actor uuid, p_target uuid, p_action text, p_old jsonb, p_new jsonb) returns void
language sql set search_path = '' as $$
  insert into public.admin_audit (actor_id, target_user_id, action, old_value, new_value)
  values (p_actor, p_target, p_action, p_old, p_new)
$$;

-- Read-only ledger summary for the console. Never creates or rolls the row;
-- a stale day simply reads as nothing used today.
create function ally_private.admin_ledger_json(p_uid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'slots_unlocked', coalesce(l.slots_unlocked, 1),
    'free_used', case when l.day = public.ist_day_key(now()) then l.free_used else 0 end,
    'free_daily', ally_private.free_daily_for(p_uid),
    'free_left', greatest(0, ally_private.free_daily_for(p_uid) - case when l.day = public.ist_day_key(now()) then l.free_used else 0 end),
    'pass_cap', ally_private.pass_cap_for(p_uid),
    'pass_active', coalesce(l.pass_ends_at > now(), false),
    'pass_started_at', l.pass_started_at,
    'pass_ends_at', l.pass_ends_at,
    'pass_used', l.pass_used
  )
  from (select p_uid as uid) x left join public.ledgers l on l.user_id = x.uid
$$;

-- One user as the list shows it. Metadata only, never message text.
create function ally_private.admin_user_json(p_uid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', u.id,
    'email', u.email,
    'is_anonymous', u.is_anonymous,
    'created_at', u.created_at,
    'last_sign_in_at', u.last_sign_in_at,
    'display_name', p.display_name,
    'role', p.role,
    'status', p.status,
    'companion_count', (select count(*) from public.companions c where c.user_id = u.id and c.status = 'active'),
    'message_count', (select count(*) from public.messages m where m.user_id = u.id),
    'ledger', ally_private.admin_ledger_json(u.id)
  )
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = p_uid
$$;

-- ---------------------------------------------------------------------------
-- Admin RPCs. SECURITY DEFINER, empty search_path, and each one starts with
-- require_admin(). Writes log to admin_audit; a call that changes nothing
-- returns changed=false and logs nothing.
-- ---------------------------------------------------------------------------

-- Newest first, keyset-paginated on (created_at, id). Pass back next_cursor's
-- created_at and id for the following page.
create function public.admin_list_users(search text default null, cursor_created_at timestamptz default null,
                                        cursor_id uuid default null, limit_n int default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit int := least(greatest(coalesce(admin_list_users.limit_n, 25), 1), 100);
  v_search text := nullif(lower(btrim(coalesce(admin_list_users.search, ''))), '');
  v_ids uuid[];
  v_page uuid[];
  v_next jsonb := null;
begin
  perform ally_private.require_admin();
  select coalesce(array_agg(s.id order by s.created_at desc, s.id desc), '{}') into v_ids
  from (
    select u.id, u.created_at from auth.users u
    where (v_search is null or strpos(lower(coalesce(u.email, '')), v_search) > 0)
      and (admin_list_users.cursor_created_at is null or admin_list_users.cursor_id is null
           or (u.created_at, u.id) < (admin_list_users.cursor_created_at, admin_list_users.cursor_id))
    order by u.created_at desc, u.id desc
    limit v_limit + 1
  ) s;
  v_page := v_ids[1:v_limit];
  if coalesce(array_length(v_ids, 1), 0) > v_limit then
    select jsonb_build_object('created_at', u.created_at, 'id', u.id) into v_next
    from auth.users u where u.id = v_page[v_limit];
  end if;
  return jsonb_build_object(
    'users', coalesce((select jsonb_agg(ally_private.admin_user_json(t.id) order by t.ord)
                       from unnest(v_page) with ordinality t(id, ord)), '[]'::jsonb),
    'next_cursor', v_next
  );
end $$;

create function public.admin_get_user(target uuid)
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
                              'created_at', c.created_at, 'last_opened_at', c.last_opened_at, 'parted_at', c.parted_at)
                              order by c.created_at, c.id)
                            from public.companions c where c.user_id = admin_get_user.target), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(jsonb_build_object(
                         'id', a.id, 'action', a.action, 'actor_id', a.actor_id, 'actor_email', au.email,
                         'old_value', a.old_value, 'new_value', a.new_value, 'created_at', a.created_at) order by a.id desc)
                       from (select * from public.admin_audit x where x.target_user_id = admin_get_user.target
                             order by x.id desc limit 20) a
                       left join auth.users au on au.id = a.actor_id), '[]'::jsonb)
  );
end $$;

create function public.admin_set_status(target uuid, status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := ally_private.require_admin();
  v_old public.user_status;
begin
  if admin_set_status.status is null or admin_set_status.status not in ('active', 'suspended') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  perform ally_private.require_user(admin_set_status.target);
  if admin_set_status.target = v_actor and admin_set_status.status = 'suspended' then
    raise exception 'cannot_suspend_self' using errcode = '22023';
  end if;
  select p.status into v_old from public.profiles p where p.id = admin_set_status.target for update;
  if v_old is null then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  if v_old::text = admin_set_status.status then
    return jsonb_build_object('changed', false, 'status', v_old);
  end if;
  update public.profiles p set status = admin_set_status.status::public.user_status where p.id = admin_set_status.target;
  perform ally_private.audit(v_actor, admin_set_status.target,
                             case when admin_set_status.status = 'suspended' then 'suspend' else 'unsuspend' end,
                             jsonb_build_object('status', v_old), jsonb_build_object('status', admin_set_status.status));
  return jsonb_build_object('changed', true, 'status', admin_set_status.status);
end $$;

create function public.admin_set_slots(target uuid, slots int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := ally_private.require_admin();
  v_ledger public.ledgers;
begin
  if admin_set_slots.slots is null or admin_set_slots.slots < 1 or admin_set_slots.slots > ally_private.max_companions() then
    raise exception 'invalid_slots' using errcode = '22023';
  end if;
  perform ally_private.require_user(admin_set_slots.target);
  v_ledger := ally_private.lock_ledger(admin_set_slots.target); -- creates the row if absent
  if v_ledger.slots_unlocked = admin_set_slots.slots then
    return jsonb_build_object('changed', false, 'ledger', ally_private.admin_ledger_json(admin_set_slots.target));
  end if;
  update public.ledgers l set slots_unlocked = admin_set_slots.slots where l.user_id = admin_set_slots.target;
  perform ally_private.audit(v_actor, admin_set_slots.target, 'set_slots',
                             jsonb_build_object('slots_unlocked', v_ledger.slots_unlocked),
                             jsonb_build_object('slots_unlocked', admin_set_slots.slots));
  return jsonb_build_object('changed', true, 'ledger', ally_private.admin_ledger_json(admin_set_slots.target));
end $$;

-- A null value clears the override.
create function public.admin_set_free_daily_override(target uuid, value int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := ally_private.require_admin();
  v_old int;
begin
  if admin_set_free_daily_override.value < 0 then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  perform ally_private.require_user(admin_set_free_daily_override.target);
  select ul.free_daily_override into v_old from public.user_limits ul where ul.user_id = admin_set_free_daily_override.target for update;
  if v_old is not distinct from admin_set_free_daily_override.value then
    return jsonb_build_object('changed', false, 'ledger', ally_private.admin_ledger_json(admin_set_free_daily_override.target));
  end if;
  insert into public.user_limits as ul (user_id, free_daily_override, updated_by)
    values (admin_set_free_daily_override.target, admin_set_free_daily_override.value, v_actor)
    on conflict (user_id) do update
      set free_daily_override = excluded.free_daily_override, updated_at = now(), updated_by = excluded.updated_by;
  perform ally_private.audit(v_actor, admin_set_free_daily_override.target, 'set_free_daily_override',
                             jsonb_build_object('free_daily_override', v_old),
                             jsonb_build_object('free_daily_override', admin_set_free_daily_override.value));
  return jsonb_build_object('changed', true, 'ledger', ally_private.admin_ledger_json(admin_set_free_daily_override.target));
end $$;

-- A null value clears the override.
create function public.admin_set_pass_cap_override(target uuid, value int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := ally_private.require_admin();
  v_old int;
begin
  if admin_set_pass_cap_override.value < 0 then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  perform ally_private.require_user(admin_set_pass_cap_override.target);
  select ul.pass_cap_override into v_old from public.user_limits ul where ul.user_id = admin_set_pass_cap_override.target for update;
  if v_old is not distinct from admin_set_pass_cap_override.value then
    return jsonb_build_object('changed', false, 'ledger', ally_private.admin_ledger_json(admin_set_pass_cap_override.target));
  end if;
  insert into public.user_limits as ul (user_id, pass_cap_override, updated_by)
    values (admin_set_pass_cap_override.target, admin_set_pass_cap_override.value, v_actor)
    on conflict (user_id) do update
      set pass_cap_override = excluded.pass_cap_override, updated_at = now(), updated_by = excluded.updated_by;
  perform ally_private.audit(v_actor, admin_set_pass_cap_override.target, 'set_pass_cap_override',
                             jsonb_build_object('pass_cap_override', v_old),
                             jsonb_build_object('pass_cap_override', admin_set_pass_cap_override.value));
  return jsonb_build_object('changed', true, 'ledger', ally_private.admin_ledger_json(admin_set_pass_cap_override.target));
end $$;

-- Starts a fresh pass now (replacing any active one). The ledger_passes row
-- has amount 0: the column is `int not null` with no range check, so 0 is a
-- valid "granted, not bought" marker without changing P2's schema.
create function public.admin_grant_pass(target uuid, hours int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := ally_private.require_admin();
  v_hours int := coalesce(admin_grant_pass.hours, ally_private.pass_hours());
  v_ledger public.ledgers;
begin
  if v_hours < 1 or v_hours > 24 * 366 then
    raise exception 'invalid_hours' using errcode = '22023';
  end if;
  perform ally_private.require_user(admin_grant_pass.target);
  v_ledger := ally_private.lock_ledger(admin_grant_pass.target);
  update public.ledgers l
    set pass_started_at = now(), pass_ends_at = now() + make_interval(hours => v_hours), pass_used = 0
    where l.user_id = admin_grant_pass.target;
  insert into public.ledger_passes (user_id, amount) values (admin_grant_pass.target, 0);
  perform ally_private.audit(v_actor, admin_grant_pass.target, 'grant_pass',
                             case when ally_private.pass_active(v_ledger)
                                  then jsonb_build_object('pass_ends_at', v_ledger.pass_ends_at, 'pass_used', v_ledger.pass_used) end,
                             jsonb_build_object('hours', v_hours, 'pass_ends_at', now() + make_interval(hours => v_hours)));
  return jsonb_build_object('changed', true, 'ledger', ally_private.admin_ledger_json(admin_grant_pass.target));
end $$;

-- Ends the active pass now. No active pass: changed=false, nothing logged.
create function public.admin_end_pass(target uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := ally_private.require_admin();
  v_ledger public.ledgers;
begin
  perform ally_private.require_user(admin_end_pass.target);
  v_ledger := ally_private.lock_ledger(admin_end_pass.target);
  if not ally_private.pass_active(v_ledger) then
    return jsonb_build_object('changed', false, 'ledger', ally_private.admin_ledger_json(admin_end_pass.target));
  end if;
  update public.ledgers l set pass_ends_at = now() where l.user_id = admin_end_pass.target;
  perform ally_private.audit(v_actor, admin_end_pass.target, 'end_pass',
                             jsonb_build_object('pass_ends_at', v_ledger.pass_ends_at, 'pass_used', v_ledger.pass_used),
                             jsonb_build_object('pass_ends_at', now()));
  return jsonb_build_object('changed', true, 'ledger', ally_private.admin_ledger_json(admin_end_pass.target));
end $$;

-- Force logout. Called only by app/api/admin/force-logout/route.ts with the
-- service-role key, after that route has checked the caller is an admin;
-- the admin check is repeated here against the actor it passes. Deleting
-- the sessions (refresh tokens cascade) is what GoTrue's own global logout
-- does: the next getUser() for any of them fails, so middleware signs that
-- device out on its next navigation.
create function public.admin_revoke_sessions(actor uuid, target uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  if not exists (select 1 from public.profiles p where p.id = admin_revoke_sessions.actor and p.role = 'admin') then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  perform ally_private.require_user(admin_revoke_sessions.target);
  delete from auth.sessions s where s.user_id = admin_revoke_sessions.target;
  get diagnostics v_count = row_count;
  perform ally_private.audit(admin_revoke_sessions.actor, admin_revoke_sessions.target, 'force_logout',
                             jsonb_build_object('sessions', v_count), jsonb_build_object('sessions', 0));
  return jsonb_build_object('revoked', v_count);
end $$;

-- ---------------------------------------------------------------------------
-- Execute grants. New functions default to executable by anon/authenticated
-- in this project, so revoke first. The admin RPCs are callable by any
-- signed-in user and refuse non-admins themselves (42501);
-- admin_revoke_sessions is service_role only.
-- ---------------------------------------------------------------------------
revoke all on all functions in schema ally_private from public, anon, authenticated;

revoke execute on function
  public.admin_list_users(text, timestamptz, uuid, int),
  public.admin_get_user(uuid),
  public.admin_set_status(uuid, text),
  public.admin_set_slots(uuid, int),
  public.admin_set_free_daily_override(uuid, int),
  public.admin_set_pass_cap_override(uuid, int),
  public.admin_grant_pass(uuid, int),
  public.admin_end_pass(uuid),
  public.admin_revoke_sessions(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.admin_list_users(text, timestamptz, uuid, int),
  public.admin_get_user(uuid),
  public.admin_set_status(uuid, text),
  public.admin_set_slots(uuid, int),
  public.admin_set_free_daily_override(uuid, int),
  public.admin_set_pass_cap_override(uuid, int),
  public.admin_grant_pass(uuid, int),
  public.admin_end_pass(uuid)
  to authenticated;
grant execute on function public.admin_revoke_sessions(uuid, uuid) to service_role;
