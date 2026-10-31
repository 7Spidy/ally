-- Name validation backstop (v3.1 patch, section 2).
-- [[:alpha:]] does not match combining marks; the client normalises to NFC and
-- launch is English only. Relax if other scripts ship.

create function ally_private.valid_display_name(t text)
returns boolean language sql immutable set search_path = '' as $$
  select t is not null
     and char_length(btrim(t)) between 2 and 24
     and btrim(t) ~ '^[[:alpha:]][[:alpha:]'' -]*[[:alpha:]]$'
$$;

-- not valid: existing rows are not rejected, new writes are checked.
alter table public.profiles
  add constraint profiles_display_name_valid
  check (display_name is null or ally_private.valid_display_name(display_name)) not valid;

create or replace function public.create_companion(template_id text, deck_gender text, answers jsonb, core jsonb, display_name text)
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

  -- An invalid name is skipped, never raised: companion creation must not fail on it.
  if ally_private.valid_display_name(create_companion.display_name) then
    update public.profiles p set display_name = btrim(create_companion.display_name)
      where p.id = v_uid and (p.display_name is null or p.display_name = '');
  end if;

  return ally_private.companion_json(v_row);
end $$;

create function public.set_display_name(p_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := ally_private.require_uid();
  v_name text := btrim(p_name);
begin
  if not ally_private.valid_display_name(v_name) then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  update public.profiles p set display_name = v_name where p.id = v_uid;
  return v_name;
end $$;

revoke all on function public.set_display_name(text) from public, anon;
grant execute on function public.set_display_name(text) to authenticated;
