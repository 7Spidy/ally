-- v3.1 patch, section 6: logging in from an anonymous session carries the
-- anonymous user's companions (and their chats) into the account being logged
-- into. Called only by app/api/account/merge/route.ts with the service role,
-- after the route has verified both sessions.
--
-- Tables keyed by a user and a companion (found from the foreign keys):
-- companions, messages, trust_days, memory_facts, memory_summaries,
-- safety_events. Ledger rows, profile, consents and limits are not merged: the
-- target's stand, and the anonymous ones go when its auth user is deleted.

create function ally_private.merge_anonymous(p_anon uuid, p_target uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_c record;
  v_active int;
  v_moved text[] := '{}';
  v_skipped jsonb := '[]'::jsonb;
  v_anon_name text;
begin
  if p_anon is null or p_target is null or p_anon = p_target then
    raise exception 'invalid_merge' using errcode = '22023';
  end if;

  -- Lock both users' ledgers (always in uuid order) so nothing else moves
  -- companions or sends messages for either user mid-merge.
  perform ally_private.lock_ledger(least(p_anon, p_target));
  perform ally_private.lock_ledger(greatest(p_anon, p_target));

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
    elsif v_active >= ally_private.max_companions() then
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

revoke all on function ally_private.merge_anonymous(uuid, uuid) from public, anon, authenticated;
grant execute on function ally_private.merge_anonymous(uuid, uuid) to service_role;

-- PostgREST only exposes public, so the route calls this thin wrapper.
create function public.merge_anonymous(p_anon uuid, p_target uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select ally_private.merge_anonymous(p_anon, p_target)
$$;

revoke all on function public.merge_anonymous(uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_anonymous(uuid, uuid) to service_role;
