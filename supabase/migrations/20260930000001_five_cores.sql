-- B1: six hidden cores become five. Rewrites the core ids stored on
-- public.companions.core: primary, secondary and every ranked[*].id.
--   KIAAN -> ROMANTIC, MEHER -> PSYCH, ANANYA -> MONEY,
--   VEER -> TRAINER, PRIYA -> FRIEND, ANAY -> FRIEND.
-- ANAY and PRIYA both become FRIEND, so their ranked entries merge and keep
-- the higher score. Idempotent: the new ids map to themselves, and the update
-- only touches rows whose core would change, so a second run changes nothing.
-- companions.answers is left alone: old floats are historical only.

create function ally_private.five_core_id(old text) returns text
language sql immutable set search_path = '' as $$
  select case old
    when 'KIAAN'  then 'ROMANTIC'
    when 'MEHER'  then 'PSYCH'
    when 'ANANYA' then 'MONEY'
    when 'VEER'   then 'TRAINER'
    when 'PRIYA'  then 'FRIEND'
    when 'ANAY'   then 'FRIEND'
    else old
  end
$$;

create function ally_private.five_core_upgrade(core jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  result jsonb := core;
  new_primary text;
  new_secondary text;
begin
  if jsonb_typeof(core->'primary') = 'string' then
    new_primary := ally_private.five_core_id(core->>'primary');
    result := jsonb_set(result, '{primary}', to_jsonb(new_primary));
  end if;

  if jsonb_typeof(core->'secondary') = 'string' then
    new_secondary := ally_private.five_core_id(core->>'secondary');
    if new_secondary is not distinct from new_primary then
      -- The support core collapsed into the primary: no support, full weight.
      result := jsonb_set(result, '{secondary}', 'null'::jsonb);
      result := jsonb_set(result, '{weight}', '100'::jsonb);
    else
      result := jsonb_set(result, '{secondary}', to_jsonb(new_secondary));
    end if;
  end if;

  if jsonb_typeof(core->'ranked') = 'array' then
    result := jsonb_set(
      result,
      '{ranked}',
      coalesce(
        (
          select jsonb_agg(jsonb_build_object('id', x.id, 'score', x.score) order by x.score desc, x.first_ord)
          from (
            select ally_private.five_core_id(t.e->>'id') as id,
                   max((t.e->>'score')::numeric)         as score,
                   min(t.ord)                            as first_ord
            from jsonb_array_elements(core->'ranked') with ordinality as t(e, ord)
            group by 1
          ) x
        ),
        '[]'::jsonb
      )
    );
  end if;

  return result;
end $$;

update public.companions
   set core = ally_private.five_core_upgrade(core)
 where core is distinct from ally_private.five_core_upgrade(core);

drop function ally_private.five_core_upgrade(jsonb);
drop function ally_private.five_core_id(text);
