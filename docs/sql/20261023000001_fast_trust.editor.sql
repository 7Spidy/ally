-- SQL-editor-ready copy of supabase/migrations/20261023000001_fast_trust.sql.
-- Run in the Supabase SQL editor (staging first, then prod). One transaction;
-- the last statement records the migration so `supabase db push` later skips it.
begin;

-- B3 fast trust: L6 in about a week.
--  * trust_days gains disclosure_count (up to 2 a day) and vuln_bonus (once a day).
--    disclosure_bonus stays as a deprecated column, written as disclosure_count > 0.
--  * write_live_reply and trust_decay are replaced (thresholds 15/45/90/140/200, decay 2).
--  * Existing companions are rescaled from the old 840-point scale and keep their level.
-- Mirrors src/lib/trust.ts; tests/unit/sqlConstants.test.ts keeps the two in step.

alter table public.trust_days
  add column disclosure_count int not null default 0 check (disclosure_count >= 0),
  add column vuln_bonus boolean not null default false;

update public.trust_days set disclosure_count = case when disclosure_bonus then 1 else 0 end;

-- ---------------------------------------------------------------------------
-- write_live_reply: same body as 20261001000001, now also writing the two new columns.
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
-- trust_decay(): thresholds 2->15, 3->45, 4->90, 5->140, 6->200; decay 2 points.
-- ---------------------------------------------------------------------------
create or replace function ally_private.trust_decay() returns void
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
      v_points := greatest(0, v_points - 2);
    end if;

    v_threshold := case v_level when 2 then 15 when 3 then 45 when 4 then 90 when 5 then 140 when 6 then 200 else 0 end;
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

-- ---------------------------------------------------------------------------
-- Rescale existing companions from the old 840-point scale, keeping their level.
-- ---------------------------------------------------------------------------
update public.companions c set
    trust_points = greatest(
      round(c.trust_points * 200.0 / 840)::int,
      case c.trust_level when 2 then 15 when 3 then 45 when 4 then 90 when 5 then 140 when 6 then 200 else 0 end
    )
  where c.trust_points > 0 or c.trust_level > 1;

insert into supabase_migrations.schema_migrations (version, name) values ('20261023000001', 'fast_trust');

commit;
