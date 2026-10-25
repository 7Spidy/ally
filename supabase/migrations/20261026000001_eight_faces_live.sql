-- B5: eight faces live for QA, one brain per face. Mirrors src/personas/registry.ts
-- (LIVE_TEMPLATES, brainOf) and src/lib/coreMap.ts. A companion is live when its
-- template is listed, its core.primary equals the face's primary core, and the
-- audience is 'all' or the owner has role admin or qa.
--
-- Rollout order (D9): land the code first, then this migration. With only the
-- code nothing new goes live, because the old is_live() still says no. With only
-- this migration, a QA owner's existing F03-F13 chat would go live before
-- personaFor() knows the persona.

-- ---------------------------------------------------------------------------
-- The live set as data: template, primary core, secondary core, audience.
-- ---------------------------------------------------------------------------
create or replace function ally_private.live_faces()
returns table (template_id text, primary_core text, secondary_core text, audience text)
language sql immutable set search_path = '' as $$
  values
    ('F01', 'ROMANTIC', 'MONEY',   'all'),
    ('F02', 'ROMANTIC', 'PSYCH',   'qa'),
    ('F03', 'ROMANTIC', 'TRAINER', 'qa'),
    ('F04', 'PSYCH',    null,      'qa'),
    ('F05', 'ROMANTIC', 'FRIEND',  'qa'),
    ('F07', 'PSYCH',    null,      'qa'),
    ('F08', 'TRAINER',  null,      'qa'),
    ('F09', 'FRIEND',   null,      'qa'),
    ('F11', 'MONEY',    null,      'qa'),
    ('F13', 'MONEY',    'FRIEND',  'qa')
$$;

-- ---------------------------------------------------------------------------
-- Live rule. Same signature as before, so every caller keeps working.
-- ---------------------------------------------------------------------------
create or replace function ally_private.is_live(c public.companions) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (c.core->>'primary') = f.primary_core
       and (f.audience = 'all'
            or exists (select 1 from public.profiles p where p.id = c.user_id and p.role in ('admin', 'qa')))
    from ally_private.live_faces() f
    where f.template_id = c.template_id
  ), false)
$$;

-- ---------------------------------------------------------------------------
-- QA: add a live test companion to the caller's own account. Bypasses
-- slots_unlocked, the companion cap and the parted-face lock. Allowed
-- templates are the rows of live_faces(); the core comes from the same row.
-- ---------------------------------------------------------------------------
create or replace function public.qa_add_companion(template_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_qa();
  v_row public.companions;
  v_primary text;
  v_secondary text;
  v_ms bigint;
begin
  select f.primary_core, f.secondary_core into v_primary, v_secondary
    from ally_private.live_faces() f
    where f.template_id = qa_add_companion.template_id;
  if not found then
    raise exception 'template_not_testable' using errcode = '22023';
  end if;

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
              jsonb_build_object('primary', v_primary, 'secondary', v_secondary, 'weight', case when v_secondary is null then 100 else 70 end, 'ranked', '[]'::jsonb))
      returning * into v_row;
      exit;
    exception when unique_violation then
      v_ms := v_ms + 1;
    end;
  end loop;

  return ally_private.companion_json(v_row);
end $$;

revoke all on all functions in schema ally_private from public, anon, authenticated;
revoke all on function ally_private.live_faces() from public, anon, authenticated;

revoke execute on function public.qa_add_companion(text) from public, anon, authenticated;
grant execute on function public.qa_add_companion(text) to authenticated;
