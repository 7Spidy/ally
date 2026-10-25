-- SQL-editor-ready copy of supabase/migrations/20261025000001_noor_live.sql.
-- Run in the Supabase SQL editor (staging first, then prod). One transaction;
-- the last statement records the migration so `supabase db push` later skips it.
begin;

-- B4: persona registry, Noor (F02) live for QA, QA add companion.
--
-- is_live() mirrors src/lib/live.ts isLive(): F01 is live for everyone, F02
-- only when the companion's owner has profile role admin or qa. Additive and
-- safe to land before the code: no qa-owned F02 rows exist until the QA button
-- is used. Flipping F02 to everyone later is a change to this function and to
-- LIVE_TEMPLATES in src/personas/registry.ts.

-- ---------------------------------------------------------------------------
-- Live rule. Stable now (it reads profiles); security definer because it is
-- reached from cron and RLS contexts that cannot read other users' profiles.
-- Same signature, so every caller (send_message/receive_reply paths, the trust
-- cron loop, admin JSON) keeps working.
-- ---------------------------------------------------------------------------
create or replace function ally_private.is_live(c public.companions) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(c.core->>'primary' = 'ROMANTIC', false) and (
    c.template_id = 'F01'
    or (c.template_id = 'F02'
        and exists (select 1 from public.profiles p where p.id = c.user_id and p.role in ('admin', 'qa')))
  )
$$;

-- ---------------------------------------------------------------------------
-- Client JSON: the server decides live-ness; the client never recomputes it.
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
    'lastCtxDay', c.last_ctx_day,
    'live', ally_private.is_live(c)
  )
$$;

-- ---------------------------------------------------------------------------
-- QA: add a live test companion to the caller's own account. Bypasses
-- slots_unlocked, the companion cap and the parted-face lock. Allowed
-- templates are the live set: F01 and F02.
-- ---------------------------------------------------------------------------
create function public.qa_add_companion(template_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_qa();
  v_row public.companions;
  v_secondary text;
  v_ms bigint;
begin
  if qa_add_companion.template_id is null or qa_add_companion.template_id not in ('F01', 'F02') then
    raise exception 'template_not_testable' using errcode = '22023';
  end if;
  v_secondary := case qa_add_companion.template_id when 'F01' then 'MONEY' else 'PSYCH' end;

  select * into v_row from public.companions c
    where c.user_id = v_uid and c.status = 'active' and c.template_id = qa_add_companion.template_id
    order by c.created_at limit 1;
  if found then
    return ally_private.companion_json(v_row);
  end if;

  delete from public.ledger_parted p where p.user_id = v_uid and p.template_id = qa_add_companion.template_id;

  v_ms := ally_private.ms(clock_timestamp());
  loop
    begin
      insert into public.companions (id, user_id, template_id, deck_gender, answers, core)
      values ('c_' || ally_private.base36(v_ms), v_uid, qa_add_companion.template_id, 'woman', ally_private.empty_answers(),
              jsonb_build_object('primary', 'ROMANTIC', 'secondary', v_secondary, 'weight', 70, 'ranked', '[]'::jsonb))
      returning * into v_row;
      exit;
    exception when unique_violation then
      v_ms := v_ms + 1;
    end;
  end loop;

  return ally_private.companion_json(v_row);
end $$;

revoke all on all functions in schema ally_private from public, anon, authenticated;

revoke execute on function public.qa_add_companion(text) from public, anon, authenticated;
grant execute on function public.qa_add_companion(text) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261025000001', 'noor_live');

commit;
