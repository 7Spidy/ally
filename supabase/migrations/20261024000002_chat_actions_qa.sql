-- B3: edit, delete and reply for the user's own chat, plus the QA tools.
--
-- Clients still have no direct write grants on messages. Every new write goes
-- through a SECURITY DEFINER RPC that proves ownership via
-- ally_private.own_companion().
--
-- Delete is a tombstone: the row stays (so ordering, quote pointers and the
-- trust/effect counters stay stable) but the text is erased and the meta is
-- stripped down to the keys the daily effect caps count.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.messages
  add column edited_at  timestamptz,
  add column edit_count int not null default 0 check (edit_count >= 0),
  add column deleted_at timestamptz;

-- ---------------------------------------------------------------------------
-- Client JSON: editedAt and deleted ride on every message.
-- ---------------------------------------------------------------------------
create or replace function ally_private.message_json(m public.messages) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', m.id, 'who', m.who, 'text', m.text, 'at', ally_private.ms(m.created_at),
                            'meta', m.meta, 'inReplyTo', m.in_reply_to,
                            'editedAt', ally_private.ms(m.edited_at),
                            'deleted', m.deleted_at is not null)
$$;

-- ---------------------------------------------------------------------------
-- send_message gains an optional reply target. The old two-argument function
-- is dropped first: PostgREST cannot choose between two overloads that both
-- match a call with named arguments {companion_id, body}.
-- ---------------------------------------------------------------------------
drop function public.send_message(text, text);

create function public.send_message(companion_id text, body text, reply_to bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_ledger public.ledgers;
  v_c public.companions;
  v_status text;
  v_msg public.messages;
  v_q bigint;
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
  if ally_private.pass_active(v_ledger) then
    update public.ledgers l set pass_used = coalesce(l.pass_used, 0) + 1 where l.user_id = v_uid;
  else
    update public.ledgers l set free_used = l.free_used + 1 where l.user_id = v_uid;
  end if;

  return jsonb_build_object('blocked', false, 'status', 'ok', 'message', ally_private.message_json(v_msg),
                            'exchanges', v_c.exchanges, 'ledger', ally_private.ledger_json(v_uid));
end $$;

-- ---------------------------------------------------------------------------
-- edit_message: own messages only, 15 minutes, 5 edits. Free: it spends no
-- credit and awards no trust (trust is scored once, when the reply is made).
-- ---------------------------------------------------------------------------
create function public.edit_message(companion_id text, message_id bigint, body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_c public.companions;
  v_m public.messages;
  v_text text := btrim(coalesce(edit_message.body, ''));
begin
  if v_text = '' then
    raise exception 'empty_message' using errcode = '22023';
  end if;
  v_c := ally_private.own_companion(v_uid, edit_message.companion_id, true);
  select * into v_m from public.messages m
    where m.id = edit_message.message_id and m.companion_id = v_c.id for update;
  if not found or v_m.who <> 'me' then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;
  if v_m.deleted_at is not null then
    raise exception 'message_deleted' using errcode = 'P0001';
  end if;
  if now() - v_m.created_at > interval '15 minutes' then
    raise exception 'edit_window_closed' using errcode = 'P0001';
  end if;
  if v_m.edit_count >= 5 then
    raise exception 'edit_limit' using errcode = 'P0001';
  end if;
  if v_text = v_m.text then
    return jsonb_build_object('message', ally_private.message_json(v_m));
  end if;
  update public.messages m
    set text = v_text, edited_at = now(), edit_count = m.edit_count + 1
    where m.id = v_m.id returning * into v_m;
  return jsonb_build_object('message', ally_private.message_json(v_m));
end $$;

-- ---------------------------------------------------------------------------
-- delete_message: either side's bubble. Idempotent. The text is erased for
-- real; meta keeps only what the daily effect caps and safety counters read.
-- ---------------------------------------------------------------------------
create function public.delete_message(companion_id text, message_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_c public.companions;
  v_m public.messages;
begin
  v_c := ally_private.own_companion(v_uid, delete_message.companion_id, true);
  select * into v_m from public.messages m
    where m.id = delete_message.message_id and m.companion_id = v_c.id for update;
  if not found then
    raise exception 'message_not_found' using errcode = 'P0002';
  end if;
  if v_m.deleted_at is null then
    update public.messages m
      set text = '',
          deleted_at = now(),
          meta = coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(m.meta) e
                            where e.key in ('effect', 'screen', 'safety')), '{}'::jsonb)
      where m.id = v_m.id returning * into v_m;
  end if;
  return jsonb_build_object('message', ally_private.message_json(v_m));
end $$;

-- ---------------------------------------------------------------------------
-- QA tools. A 'qa' or 'admin' profile may use them, on their OWN companions.
-- ---------------------------------------------------------------------------
create function public.is_qa() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'qa'));
$$;

create function ally_private.require_qa() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v uuid := ally_private.require_uid();
begin
  if not public.is_qa() then
    raise exception 'not_qa' using errcode = '42501';
  end if;
  return v;
end $$;

create function ally_private.trust_threshold(p_level int) returns int
language sql immutable set search_path = '' as $$
  select case p_level when 2 then 15 when 3 then 45 when 4 then 90 when 5 then 140 when 6 then 200 else 0 end
$$;

-- Sets the level (1..6) and parks the points exactly on its threshold so the
-- nightly decay has nothing to demote. A fresh level_changed_at makes the next
-- chat open show the level-up card. Freezing is separate (qa_set_freeze).
create function public.qa_set_level(companion_id text, lvl int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_qa();
  v_c public.companions;
begin
  if qa_set_level.lvl is null or qa_set_level.lvl < 1 or qa_set_level.lvl > 6 then
    raise exception 'bad_level' using errcode = '22023';
  end if;
  v_c := ally_private.own_companion(v_uid, qa_set_level.companion_id, true);
  update public.companions c set
      trust_level = qa_set_level.lvl,
      highest_level = greatest(c.highest_level, qa_set_level.lvl),
      trust_points = ally_private.trust_threshold(qa_set_level.lvl),
      level_changed_at = now(),
      below_since = null,
      signal_since_level = false,
      cool_off_until = null
    where c.id = v_c.id returning * into v_c;
  return jsonb_build_object('trustLevel', v_c.trust_level, 'levelChangedAt', ally_private.ms(v_c.level_changed_at));
end $$;

-- Stops trust moving at all (a 30 day freeze) or lifts it, so a level set for
-- a test holds while chatting. Touches nothing else.
create function public.qa_set_freeze(companion_id text, freeze boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_qa();
  v_c public.companions;
begin
  v_c := ally_private.own_companion(v_uid, qa_set_freeze.companion_id, true);
  update public.companions c set
      trust_frozen_until = case when coalesce(qa_set_freeze.freeze, false) then now() + interval '30 days' else null end
    where c.id = v_c.id returning * into v_c;
  return jsonb_build_object('frozen', v_c.trust_frozen_until is not null and v_c.trust_frozen_until > now());
end $$;

-- Read-only numbers the client never normally sees.
create function public.qa_state(companion_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_qa();
  v_c public.companions;
  v_start timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_effects jsonb;
  v_screens int;
begin
  v_c := ally_private.own_companion(v_uid, qa_state.companion_id, false);
  select coalesce(jsonb_object_agg(x.e, x.n), '{}'::jsonb) into v_effects from (
    select m.meta->>'effect' as e, count(*) as n from public.messages m
      where m.companion_id = v_c.id and m.who = 'them' and m.created_at >= v_start and m.meta ? 'effect'
      group by 1) x;
  select count(*) into v_screens from public.messages m
    where m.companion_id = v_c.id and m.who = 'them' and m.created_at >= v_start and m.meta ? 'screen';
  return jsonb_build_object(
    'level', v_c.trust_level,
    'highestLevel', v_c.highest_level,
    'points', v_c.trust_points,
    'nextThreshold', case when v_c.trust_level >= 6 then null else ally_private.trust_threshold(v_c.trust_level + 1) end,
    'relationshipDay', (now() at time zone 'Asia/Kolkata')::date - (v_c.created_at at time zone 'Asia/Kolkata')::date,
    'frozen', v_c.trust_frozen_until is not null and v_c.trust_frozen_until > now(),
    'coolOff', v_c.cool_off_until is not null and v_c.cool_off_until > now(),
    'safetyMode', v_c.safety_until is not null and v_c.safety_until > now(),
    'effectsToday', v_effects,
    'screensToday', v_screens);
end $$;

-- Today's free allowance (and the pass count, if a pass is running) back to zero used.
create function public.qa_refill_messages()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_qa();
  v_ledger public.ledgers;
begin
  v_ledger := ally_private.lock_ledger(v_uid);
  update public.ledgers l set
      free_used = 0,
      pass_used = case when l.pass_started_at is null then l.pass_used else 0 end
    where l.user_id = v_uid;
  return jsonb_build_object('ledger', ally_private.ledger_json(v_uid));
end $$;

-- Wipes the conversation (messages and counters) so the opener can be tested
-- again. Trust level, memory and the ledger are untouched.
create function public.qa_reset_chat(companion_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_qa();
  v_c public.companions;
begin
  v_c := ally_private.own_companion(v_uid, qa_reset_chat.companion_id, true);
  delete from public.messages m where m.companion_id = v_c.id;
  update public.companions c set exchanges = 0, unread = 0, last_replied_msg = 0, last_ctx_day = null
    where c.id = v_c.id;
  return jsonb_build_object('reset', true);
end $$;

-- ---------------------------------------------------------------------------
-- Execute grants (new functions are executable by anon/authenticated by default
-- in this project, so revoke first). Every function refuses an unsigned caller
-- itself via require_uid(); the qa_* ones refuse non-QA callers too.
-- ---------------------------------------------------------------------------
revoke all on all functions in schema ally_private from public, anon, authenticated;

revoke execute on function
  public.send_message(text, text, bigint),
  public.edit_message(text, bigint, text),
  public.delete_message(text, bigint),
  public.is_qa(),
  public.qa_set_level(text, int),
  public.qa_set_freeze(text, boolean),
  public.qa_state(text),
  public.qa_refill_messages(),
  public.qa_reset_chat(text)
  from public, anon, authenticated;
grant execute on function
  public.send_message(text, text, bigint),
  public.edit_message(text, bigint, text),
  public.delete_message(text, bigint),
  public.is_qa(),
  public.qa_set_level(text, int),
  public.qa_set_freeze(text, boolean),
  public.qa_state(text),
  public.qa_refill_messages(),
  public.qa_reset_chat(text)
  to authenticated;
