-- U1: UX fixes (docs: claude_change_spec.md, section 3).
-- get_my_state pages messages (newest 50 per companion), plus the RPCs behind
-- history paging, the pinned list, "what she remembers" deletion, edit
-- regeneration and the data export. Written as `create or replace` over the
-- 20261111000001 functions so applied migrations stay untouched.

-- ---------------------------------------------------------------------------
-- get_my_state: as plans_and_trial's, with messages_by_companion limited to the
-- newest 50 rows per companion (still oldest to newest) and has_more_by_companion
-- saying whether older rows exist. Nothing else in the payload changes.
-- ---------------------------------------------------------------------------
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
                                         from public.messages m
                                         where m.user_id = v_uid
                                           and m.id in (select t.id from (
                                                 select m2.id, row_number() over (partition by m2.companion_id order by m2.created_at desc, m2.id desc) as rn
                                                 from public.messages m2 where m2.user_id = v_uid) t
                                               where t.rn <= 50)
                                         group by m.companion_id) x), '{}'::jsonb),
    'has_more_by_companion', coalesce((select jsonb_object_agg(y.companion_id, y.n > 50) from (
                                         select m.companion_id, count(*) as n
                                         from public.messages m where m.user_id = v_uid group by m.companion_id) y), '{}'::jsonb),
    'ledger', ally_private.ledger_json(v_uid),
    'entitlement', ally_private.entitlement_for(v_uid),
    'profile', (select jsonb_build_object('display_name', p.display_name) from public.profiles p where p.id = v_uid),
    'consent', (select jsonb_build_object('granted_at', ally_private.ms(c.granted_at), 'marketing', c.marketing, 'version', c.version)
                from public.consents c where c.user_id = v_uid order by c.granted_at desc, c.id desc limit 1)
  );
end $$;

-- ---------------------------------------------------------------------------
-- write_live_reply: as fast_trust's, and the answered user message loses meta.regen
-- in the same write (see retract_reply). Nothing else changes.
-- ---------------------------------------------------------------------------
create or replace function ally_private.write_live_reply(p jsonb) returns jsonb
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
    -- A regenerated reply (retract_reply set meta.regen) is done: clear the flag in the same write.
    update public.messages m set meta = m.meta - 'regen'
      where m.id = v_umsg and m.companion_id = v_c.id and m.who = 'me' and m.meta ? 'regen';
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
    -- disclosure_bonus is deprecated; kept in step as disclosure_count > 0 for anything still reading it.
    insert into public.trust_days (companion_id, user_id, day, msg_points, session_bonus, disclosure_bonus, disclosure_count, vuln_bonus, user_msgs)
      values (v_c.id, v_c.user_id, v_d->>'key', (v_d->>'msgPoints')::int, (v_d->>'sessionBonus')::boolean,
              coalesce((v_d->>'disclosureCount')::int, 0) > 0, coalesce((v_d->>'disclosureCount')::int, 0),
              coalesce((v_d->>'vulnBonus')::boolean, false), (v_d->>'userMsgs')::int)
      on conflict (companion_id, day) do update set
        msg_points = excluded.msg_points, session_bonus = excluded.session_bonus,
        disclosure_bonus = excluded.disclosure_bonus, disclosure_count = excluded.disclosure_count,
        vuln_bonus = excluded.vuln_bonus, user_msgs = excluded.user_msgs;
  end if;

  for v_kind in select jsonb_array_elements_text(coalesce(p->'events', '[]'::jsonb)) loop
    insert into public.safety_events (user_id, companion_id, kind) values (v_c.user_id, v_c.id, v_kind);
  end loop;

  return jsonb_build_object('discarded', false, 'bubbles', v_out);
end $$;

-- ---------------------------------------------------------------------------
-- get_messages_before: one older page of a chat, oldest to newest. Owner only
-- (own_companion raises companion_not_found for anyone else). Works on locked
-- and expired companions: reading history is never gated by a plan.
-- ---------------------------------------------------------------------------
create function public.get_messages_before(companion_id text, before_id bigint, limit_n int default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_c public.companions;
  v_n int := least(100, greatest(1, coalesce(get_messages_before.limit_n, 50)));
  v_ids bigint[];
  v_more boolean;
begin
  v_c := ally_private.own_companion(v_uid, get_messages_before.companion_id, false);
  select coalesce(array_agg(t.id), '{}') into v_ids from (
    select m.id from public.messages m
      where m.companion_id = v_c.id and m.id < get_messages_before.before_id
      order by m.created_at desc, m.id desc limit v_n) t;
  select exists (select 1 from public.messages m
                  where m.companion_id = v_c.id and m.id < get_messages_before.before_id
                    and m.id <> all (v_ids)) into v_more;
  return jsonb_build_object(
    'messages', coalesce((select jsonb_agg(ally_private.message_json(m) order by m.created_at, m.id)
                          from public.messages m where m.id = any (v_ids)), '[]'::jsonb),
    'hasMore', v_more);
end $$;

-- ---------------------------------------------------------------------------
-- get_pinned_messages: her non-deleted pinned bubbles, newest first, max 50.
-- ---------------------------------------------------------------------------
create function public.get_pinned_messages(companion_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_c public.companions;
begin
  v_c := ally_private.own_companion(v_uid, get_pinned_messages.companion_id, false);
  return coalesce((select jsonb_agg(ally_private.message_json(m) order by m.created_at desc, m.id desc)
                   from public.messages m
                   where m.id in (select p.id from public.messages p
                                    where p.companion_id = v_c.id and p.who = 'them' and p.deleted_at is null
                                      and p.meta->>'effect' = 'pin'
                                    order by p.created_at desc, p.id desc limit 50)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- delete_memory_fact: hard delete of one of the caller's memory_facts rows.
-- Idempotent. No tombstone and no block list: she can relearn it. Allowed for
-- locked and expired companions (it only touches the caller's own row).
-- ---------------------------------------------------------------------------
create function public.delete_memory_fact(fact_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_n int;
begin
  delete from public.memory_facts f where f.id = delete_memory_fact.fact_id and f.user_id = v_uid;
  get diagnostics v_n = row_count;
  return jsonb_build_object('deleted', v_n > 0);
end $$;

-- ---------------------------------------------------------------------------
-- retract_reply: edit regeneration. The edited message must be the newest of the
-- caller's own and everything after it must be her reply to it. Her reply rows
-- are removed for real, the user message loses its tapback and gets meta.regen,
-- and last_replied_msg steps back so the reply route's claim succeeds again.
-- No ledger debit, no fair-use count, no trust change.
-- Errors: not_latest (something else follows), not_allowed (plan, pause or edit state).
-- ---------------------------------------------------------------------------
create function public.retract_reply(companion_id text, message_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_c public.companions;
  v_m public.messages;
  v_ent jsonb;
  v_removed bigint[];
begin
  perform ally_private.lock_ledger(v_uid);
  v_c := ally_private.own_companion(v_uid, retract_reply.companion_id, false);
  select * into v_m from public.messages m
    where m.id = retract_reply.message_id and m.companion_id = v_c.id and m.user_id = v_uid for update;
  if not found or v_m.who <> 'me' or v_m.deleted_at is not null or v_m.edited_at is null then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  -- The newest own, non-deleted message in the chat.
  if exists (select 1 from public.messages m
              where m.companion_id = v_c.id and m.who = 'me' and m.id > v_m.id) then
    raise exception 'not_latest' using errcode = 'P0001';
  end if;
  -- Every row after it must be her reply to it.
  if exists (select 1 from public.messages m
              where m.companion_id = v_c.id and m.id > v_m.id
                and not (m.who = 'them' and m.in_reply_to is not distinct from v_m.id)) then
    raise exception 'not_latest' using errcode = 'P0001';
  end if;
  -- Active, not paused, and the plan lets the caller send to it.
  v_ent := ally_private.entitlement_for(v_uid);
  if v_c.status <> 'active' or v_c.paused_reason is not null
     or v_ent->>'plan' = 'expired' or ally_private.companion_locked(v_c) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  with gone as (
    delete from public.messages m
      where m.companion_id = v_c.id and m.id > v_m.id and m.who = 'them' and m.in_reply_to = v_m.id
      returning m.id)
  select coalesce(array_agg(g.id order by g.id), '{}') into v_removed from gone g;

  update public.messages m
    set meta = jsonb_set(m.meta - 'reaction', '{regen}', 'true'::jsonb)
    where m.id = v_m.id returning * into v_m;
  update public.companions c set last_replied_msg = v_m.id - 1 where c.id = v_c.id;

  return jsonb_build_object('removedIds', to_jsonb(v_removed), 'message', ally_private.message_json(v_m));
end $$;

-- ---------------------------------------------------------------------------
-- export_my_data: everything the caller owns that the app can show them. Deleted
-- messages are tombstones without text. Never returns hidden fair-use caps,
-- trust points, safety_events or admin fields.
-- ---------------------------------------------------------------------------
create function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
begin
  return jsonb_build_object(
    'exported_at', ally_private.ms(now()),
    'profile', (select jsonb_build_object('display_name', p.display_name, 'created_at', ally_private.ms(p.created_at))
                from public.profiles p where p.id = v_uid),
    'consents', coalesce((select jsonb_agg(jsonb_build_object('version', c.version, 'marketing', c.marketing,
                                                              'granted_at', ally_private.ms(c.granted_at)) order by c.granted_at, c.id)
                          from public.consents c where c.user_id = v_uid), '[]'::jsonb),
    'entitlement', ally_private.entitlement_for(v_uid),
    'companions', coalesce((select jsonb_agg(jsonb_build_object(
                              'id', c.id, 'templateId', c.template_id, 'deckGender', c.deck_gender, 'answers', c.answers,
                              'core', c.core, 'createdAt', ally_private.ms(c.created_at), 'status', c.status,
                              'partedAt', ally_private.ms(c.parted_at), 'exchanges', c.exchanges)
                              order by c.created_at, c.id)
                            from public.companions c where c.user_id = v_uid), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object(
                            'id', m.id, 'companionId', m.companion_id, 'who', m.who,
                            'text', case when m.deleted_at is null then m.text end,
                            'at', ally_private.ms(m.created_at), 'editedAt', ally_private.ms(m.edited_at),
                            'deleted', m.deleted_at is not null)
                            order by m.created_at, m.id)
                          from public.messages m where m.user_id = v_uid), '[]'::jsonb),
    'memory_facts', coalesce((select jsonb_agg(jsonb_build_object(
                                'id', f.id, 'companionId', f.companion_id, 'category', f.category, 'fact', f.fact,
                                'active', f.active, 'createdAt', ally_private.ms(f.created_at))
                                order by f.id)
                              from public.memory_facts f where f.user_id = v_uid), '[]'::jsonb),
    'memory_summaries', coalesce((select jsonb_agg(jsonb_build_object(
                                    'id', s.id, 'companionId', s.companion_id, 'period', s.period,
                                    'periodKey', s.period_key, 'summary', s.summary,
                                    'createdAt', ally_private.ms(s.created_at))
                                    order by s.id)
                                  from public.memory_summaries s where s.user_id = v_uid), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on all functions in schema ally_private from public, anon, authenticated;

revoke execute on function
  public.get_messages_before(text, bigint, int),
  public.get_pinned_messages(text),
  public.delete_memory_fact(bigint),
  public.retract_reply(text, bigint),
  public.export_my_data()
  from public, anon;
grant execute on function
  public.get_messages_before(text, bigint, int),
  public.get_pinned_messages(text),
  public.delete_memory_fact(bigint),
  public.retract_reply(text, bigint),
  public.export_my_data()
  to authenticated;

-- The blanket revoke above (and the one in plans_and_trial) strips the execute that
-- 20261103000001 granted on this pure predicate, which the profiles_display_name_valid
-- check constraint needs for any direct write to profiles. Grant it again.
grant execute on function ally_private.valid_display_name(text) to anon, authenticated, service_role;
