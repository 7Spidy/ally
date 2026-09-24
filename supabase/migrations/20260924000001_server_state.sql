-- P2: server-side state. Companions, messages and the ledger move out of
-- localStorage into these six tables. Clients may only SELECT their own rows
-- (RLS); every write goes through the SECURITY DEFINER RPCs below (spec D3),
-- so a client can never grant itself credits or slots with a direct UPDATE.

create schema if not exists ally_private;
revoke all on schema ally_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Constants. Keep in sync with src/lib/config.ts: tests/unit/sqlConstants.test.ts
-- parses these definitions and fails if either side changes on its own.
-- ---------------------------------------------------------------------------
create function ally_private.free_daily() returns int language sql immutable set search_path = '' as $$ select 100 $$;
create function ally_private.pass_hours() returns int language sql immutable set search_path = '' as $$ select 24 $$;
create function ally_private.pass_cap() returns int language sql immutable set search_path = '' as $$ select 2000 $$;
create function ally_private.max_companions() returns int language sql immutable set search_path = '' as $$ select 3 $$;
create function ally_private.part_purge_days() returns int language sql immutable set search_path = '' as $$ select 30 $$;
create function ally_private.price_day_pass() returns int language sql immutable set search_path = '' as $$ select 49 $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.companions (
  id             text primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  template_id    text not null,
  deck_gender    text not null check (deck_gender in ('woman', 'man')),
  answers        jsonb not null check (jsonb_typeof(answers) = 'object'),
  core           jsonb not null check (jsonb_typeof(core) = 'object'),
  created_at     timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  status         text not null default 'active' check (status in ('active', 'parted')),
  parted_at      timestamptz,
  purge_at       timestamptz,
  exchanges      int not null default 0,
  unread         int not null default 0,
  notify         boolean not null default true,
  sound          boolean not null default true
);
create index companions_user_id_idx on public.companions (user_id);

create table public.messages (
  id           bigint generated always as identity primary key,
  companion_id text not null references public.companions(id) on delete cascade,
  -- Denormalised so the RLS check needs no join.
  user_id      uuid not null references auth.users(id) on delete cascade,
  who          text not null check (who in ('them', 'me')),
  text         text not null,
  created_at   timestamptz not null default now()
);
create index messages_companion_created_idx on public.messages (companion_id, created_at);
create index messages_user_id_idx on public.messages (user_id);

create table public.ledgers (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  slots_unlocked  int not null default 1,
  day             text not null, -- Asia/Kolkata YYYY-MM-DD, as dayKey() in src/lib/clock.ts
  free_used       int not null default 0,
  pass_started_at timestamptz,
  pass_ends_at    timestamptz,
  pass_used       int,
  updated_at      timestamptz not null default now()
);
create trigger ledgers_touch before update on public.ledgers
  for each row execute function public.touch_updated_at();

create table public.ledger_unlocks (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  slot    int not null,
  at      timestamptz not null default now(),
  amount  int not null
);
create index ledger_unlocks_user_id_idx on public.ledger_unlocks (user_id);

create table public.ledger_passes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  amount     int not null
);
create index ledger_passes_user_id_idx on public.ledger_passes (user_id);

create table public.ledger_parted (
  user_id     uuid not null references auth.users(id) on delete cascade,
  template_id text not null,
  primary key (user_id, template_id)
);

-- ---------------------------------------------------------------------------
-- RLS and grants (spec D10: every table gets both, in this migration)
-- ---------------------------------------------------------------------------
alter table public.companions     enable row level security;
alter table public.messages       enable row level security;
alter table public.ledgers        enable row level security;
alter table public.ledger_unlocks enable row level security;
alter table public.ledger_passes  enable row level security;
alter table public.ledger_parted  enable row level security;

create policy companions_select_own     on public.companions     for select to authenticated using (user_id = (select auth.uid()));
create policy messages_select_own       on public.messages       for select to authenticated using (user_id = (select auth.uid()));
create policy ledgers_select_own        on public.ledgers        for select to authenticated using (user_id = (select auth.uid()));
create policy ledger_unlocks_select_own on public.ledger_unlocks for select to authenticated using (user_id = (select auth.uid()));
create policy ledger_passes_select_own  on public.ledger_passes  for select to authenticated using (user_id = (select auth.uid()));
create policy ledger_parted_select_own  on public.ledger_parted  for select to authenticated using (user_id = (select auth.uid()));

-- Clients read only. No insert/update/delete for anon or authenticated on any
-- of the six tables; writes happen inside the RPCs, which run as the owner.
revoke all on public.companions, public.messages, public.ledgers,
              public.ledger_unlocks, public.ledger_passes, public.ledger_parted
  from anon, authenticated;
grant select on public.companions, public.messages, public.ledgers,
                public.ledger_unlocks, public.ledger_passes, public.ledger_parted
  to authenticated;
grant select, insert, update, delete on public.companions, public.messages, public.ledgers,
                                        public.ledger_unlocks, public.ledger_passes, public.ledger_parted
  to service_role;
grant usage, select on sequence public.messages_id_seq, public.ledger_unlocks_id_seq, public.ledger_passes_id_seq
  to service_role;

-- ---------------------------------------------------------------------------
-- Internal helpers (ally_private is not exposed through the API)
-- ---------------------------------------------------------------------------

-- Asia/Kolkata calendar day for an instant. Public (read-only, pure) so the
-- RLS suite can check it against dayKey() at the midnight IST boundary.
create function public.ist_day_key(ts timestamptz) returns text
language sql stable set search_path = '' as $$
  select to_char(ts at time zone 'Asia/Kolkata', 'YYYY-MM-DD')
$$;

create function ally_private.ms(ts timestamptz) returns bigint
language sql immutable set search_path = '' as $$
  select floor(extract(epoch from ts) * 1000)::bigint
$$;

create function ally_private.base36(n bigint) returns text
language plpgsql immutable set search_path = '' as $$
declare
  digits constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  v bigint := n;
  s text := '';
begin
  if v = 0 then return '0'; end if;
  while v > 0 loop
    s := substr(digits, (v % 36)::int + 1, 1) || s;
    v := v / 36;
  end loop;
  return s;
end $$;

create function ally_private.empty_answers() returns jsonb language sql immutable set search_path = '' as $$
  select '{"q5":null,"q6":null,"q7":null,"q8":null,"q9":null,"q10":null,"q11":[]}'::jsonb
$$;

create function ally_private.empty_core() returns jsonb language sql immutable set search_path = '' as $$
  select '{"primary":null,"secondary":null,"weight":null,"ranked":[]}'::jsonb
$$;

create function ally_private.require_uid() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v uuid := auth.uid();
begin
  if v is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return v;
end $$;

-- Creates the caller's ledger row on first use, locks it for the rest of the
-- transaction (serialising concurrent sends/creates for one user) and applies
-- rollDay(): a new Asia/Kolkata day zeroes free_used.
create function ally_private.lock_ledger(p_uid uuid) returns public.ledgers
language plpgsql set search_path = '' as $$
declare
  l public.ledgers;
  today text := public.ist_day_key(now());
begin
  insert into public.ledgers (user_id, day) values (p_uid, today) on conflict (user_id) do nothing;
  select * into l from public.ledgers where user_id = p_uid for update;
  if l.day <> today then
    update public.ledgers set day = today, free_used = 0 where user_id = p_uid returning * into l;
  end if;
  return l;
end $$;

-- passActive()
create function ally_private.pass_active(l public.ledgers) returns boolean
language sql stable set search_path = '' as $$
  select l.pass_ends_at is not null and now() < l.pass_ends_at
$$;

-- canSend(), on a ledger already rolled by lock_ledger(): 'ok' | 'capped' | 'empty'
create function ally_private.can_send(l public.ledgers) returns text
language sql stable set search_path = '' as $$
  select case
    when ally_private.pass_active(l) then
      case when coalesce(l.pass_used, 0) < ally_private.pass_cap() then 'ok' else 'capped' end
    when ally_private.free_daily() - l.free_used > 0 then 'ok'
    else 'empty'
  end
$$;

-- The client's `Ledger` shape (src/state/schema.ts), timestamps in epoch ms.
create function ally_private.ledger_json(p_uid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'slotsUnlocked', l.slots_unlocked,
    'day', l.day,
    'freeUsed', l.free_used,
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

-- The client's `Companion` shape minus messages (sent separately).
create function ally_private.companion_json(c public.companions) returns jsonb
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
    'sound', c.sound
  )
$$;

create function ally_private.message_json(m public.messages) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('who', m.who, 'text', m.text, 'at', ally_private.ms(m.created_at))
$$;

-- Locks and returns one of the caller's companions, or raises P0002.
create function ally_private.own_companion(p_uid uuid, p_id text, p_active_only boolean) returns public.companions
language plpgsql set search_path = '' as $$
declare
  c public.companions;
begin
  select * into c from public.companions where id = p_id and user_id = p_uid for update;
  if not found or (p_active_only and c.status <> 'active') then
    raise exception 'companion_not_found' using errcode = 'P0002';
  end if;
  return c;
end $$;

-- PURGE_PARTED: past purge_at, a parted companion loses its messages,
-- answers, core and unread count. The row (and its ledger_parted entry)
-- stays so the face remains excluded. p_uid null means every user (cron).
create function ally_private.purge_parted(p_uid uuid) returns void
language plpgsql set search_path = '' as $$
begin
  delete from public.messages m
    using public.companions c
    where m.companion_id = c.id
      and c.status = 'parted' and c.purge_at <= now()
      and (p_uid is null or c.user_id = p_uid);
  update public.companions c
    set answers = ally_private.empty_answers(), core = ally_private.empty_core(), unread = 0
    where c.status = 'parted' and c.purge_at <= now()
      and (p_uid is null or c.user_id = p_uid)
      and (c.answers <> ally_private.empty_answers() or c.core <> ally_private.empty_core() or c.unread <> 0);
end $$;

revoke all on all functions in schema ally_private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs. All SECURITY DEFINER with an empty search_path, acting only on
-- auth.uid()'s rows. Each mirrors the reducer case named in its comment.
-- ---------------------------------------------------------------------------

-- CONFIRM_LOCK
create function public.create_companion(template_id text, deck_gender text, answers jsonb, core jsonb, display_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_ledger public.ledgers;
  v_active int;
  v_ms bigint;
  v_row public.companions;
begin
  v_ledger := ally_private.lock_ledger(v_uid);
  select count(*) into v_active from public.companions c where c.user_id = v_uid and c.status = 'active';
  if v_active >= v_ledger.slots_unlocked then
    raise exception 'slots_full' using errcode = 'P0001';
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

  if nullif(btrim(coalesce(create_companion.display_name, '')), '') is not null then
    update public.profiles p set display_name = left(btrim(create_companion.display_name), 40)
      where p.id = v_uid and (p.display_name is null or p.display_name = '');
  end if;

  return ally_private.companion_json(v_row);
end $$;

-- SEND_MESSAGE + SPEND_MESSAGE, one transaction
create function public.send_message(companion_id text, body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_ledger public.ledgers;
  v_c public.companions;
  v_status text;
  v_msg public.messages;
begin
  if nullif(btrim(coalesce(send_message.body, '')), '') is null then
    raise exception 'empty_message' using errcode = '22023';
  end if;
  v_ledger := ally_private.lock_ledger(v_uid);
  v_c := ally_private.own_companion(v_uid, send_message.companion_id, true);
  v_status := ally_private.can_send(v_ledger);
  if v_status <> 'ok' then
    return jsonb_build_object('blocked', true, 'status', v_status, 'message', null,
                              'exchanges', v_c.exchanges, 'ledger', ally_private.ledger_json(v_uid));
  end if;

  insert into public.messages (companion_id, user_id, who, text)
    values (v_c.id, v_uid, 'me', send_message.body) returning * into v_msg;
  update public.companions c set exchanges = c.exchanges + 1 where c.id = v_c.id returning * into v_c;
  -- spend(): the pass if one is active, otherwise the free allowance
  if ally_private.pass_active(v_ledger) then
    update public.ledgers l set pass_used = coalesce(l.pass_used, 0) + 1 where l.user_id = v_uid;
  else
    update public.ledgers l set free_used = l.free_used + 1 where l.user_id = v_uid;
  end if;

  return jsonb_build_object('blocked', false, 'status', 'ok', 'message', ally_private.message_json(v_msg),
                            'exchanges', v_c.exchanges, 'ledger', ally_private.ledger_json(v_uid));
end $$;

-- RECEIVE_REPLY. The text is still generated client-side by replyFor().
create function public.receive_reply(companion_id text, body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_c public.companions;
  v_msg public.messages;
begin
  v_c := ally_private.own_companion(v_uid, receive_reply.companion_id, true);
  insert into public.messages (companion_id, user_id, who, text)
    values (v_c.id, v_uid, 'them', receive_reply.body) returning * into v_msg;
  update public.companions c set unread = c.unread + 1 where c.id = v_c.id returning * into v_c;
  return jsonb_build_object('message', ally_private.message_json(v_msg), 'unread', v_c.unread);
end $$;

-- SEED_OPENER: like receive_reply, but only into an empty conversation, so a
-- second tab or a remount can never post a second opener.
create function public.seed_opener(companion_id text, body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_c public.companions;
  v_msg public.messages;
begin
  v_c := ally_private.own_companion(v_uid, seed_opener.companion_id, true);
  if exists (select 1 from public.messages m where m.companion_id = v_c.id) then
    return jsonb_build_object('message', null, 'unread', v_c.unread);
  end if;
  insert into public.messages (companion_id, user_id, who, text)
    values (v_c.id, v_uid, 'them', seed_opener.body) returning * into v_msg;
  update public.companions c set unread = c.unread + 1 where c.id = v_c.id returning * into v_c;
  return jsonb_build_object('message', ally_private.message_json(v_msg), 'unread', v_c.unread);
end $$;

-- OPEN_CHAT
create function public.open_chat(companion_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_c public.companions;
begin
  v_c := ally_private.own_companion(v_uid, open_chat.companion_id, false);
  update public.companions c set last_opened_at = now(), unread = 0 where c.id = v_c.id returning * into v_c;
  return jsonb_build_object('lastOpenedAt', ally_private.ms(v_c.last_opened_at));
end $$;

-- PART_COMPANION. Idempotent: parting an already parted companion returns
-- its existing dates.
create function public.part_companion(companion_id text)
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
                            'ledger', ally_private.ledger_json(v_uid));
end $$;

-- UNLOCK_SLOT. Mock purchase: the amount is trusted from the client until a
-- real payment gateway exists (same trust level as the pre-P2 build).
create function public.unlock_slot(amount int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_ledger public.ledgers;
  v_slots int;
begin
  if unlock_slot.amount is null or unlock_slot.amount < 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  v_ledger := ally_private.lock_ledger(v_uid);
  v_slots := least(ally_private.max_companions(), v_ledger.slots_unlocked + 1);
  update public.ledgers l set slots_unlocked = v_slots where l.user_id = v_uid;
  insert into public.ledger_unlocks (user_id, slot, amount) values (v_uid, v_slots, unlock_slot.amount);
  return jsonb_build_object('ledger', ally_private.ledger_json(v_uid));
end $$;

-- BUY_PASS. No-op while a pass is already active.
create function public.buy_pass()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_ledger public.ledgers;
begin
  v_ledger := ally_private.lock_ledger(v_uid);
  if not ally_private.pass_active(v_ledger) then
    update public.ledgers l
      set pass_started_at = now(), pass_ends_at = now() + make_interval(hours => ally_private.pass_hours()), pass_used = 0
      where l.user_id = v_uid;
    insert into public.ledger_passes (user_id, amount) values (v_uid, ally_private.price_day_pass());
  end if;
  return jsonb_build_object('ledger', ally_private.ledger_json(v_uid));
end $$;

-- SET_NOTIFY / SET_SOUND (per-companion preferences live on the row)
create function public.set_companion_prefs(companion_id text, notify boolean default null, sound boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_c public.companions;
begin
  v_c := ally_private.own_companion(v_uid, set_companion_prefs.companion_id, false);
  update public.companions c
    set notify = coalesce(set_companion_prefs.notify, c.notify), sound = coalesce(set_companion_prefs.sound, c.sound)
    where c.id = v_c.id returning * into v_c;
  return jsonb_build_object('notify', v_c.notify, 'sound', v_c.sound);
end $$;

-- PURGE_PARTED for the caller
create function public.purge_parted_now()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform ally_private.purge_parted(ally_private.require_uid());
end $$;

-- Everything the client cache needs on boot. Purges first, so a stale client
-- never sees data past its purge date.
create function public.get_my_state()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
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

-- Execute for signed-in users only (anonymous sessions are `authenticated`).
revoke execute on function
  public.create_companion(text, text, jsonb, jsonb, text),
  public.send_message(text, text),
  public.receive_reply(text, text),
  public.seed_opener(text, text),
  public.open_chat(text),
  public.part_companion(text),
  public.unlock_slot(int),
  public.buy_pass(),
  public.set_companion_prefs(text, boolean, boolean),
  public.purge_parted_now(),
  public.get_my_state(),
  public.ist_day_key(timestamptz)
  from public, anon;
grant execute on function
  public.create_companion(text, text, jsonb, jsonb, text),
  public.send_message(text, text),
  public.receive_reply(text, text),
  public.seed_opener(text, text),
  public.open_chat(text),
  public.part_companion(text),
  public.unlock_slot(int),
  public.buy_pass(),
  public.set_companion_prefs(text, boolean, boolean),
  public.purge_parted_now(),
  public.get_my_state(),
  public.ist_day_key(timestamptz)
  to authenticated;

-- Nightly 03:05 IST, just after P1's anonymous-user reaper: purge parted
-- companions past purge_at for every user. A second job rather than an edit
-- to P1's, so the applied auth_foundation migration stays untouched.
select cron.schedule(
  'purge-parted-companions',
  '35 21 * * *',
  $$ select ally_private.purge_parted(null) $$
);
