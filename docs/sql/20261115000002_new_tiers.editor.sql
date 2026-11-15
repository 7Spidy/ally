-- SQL-editor-ready copy of supabase/migrations/20261115000002_new_tiers.sql.
-- Run in the Supabase SQL editor (staging first, then prod). One transaction;
-- the last statement records the migration so `supabase db push` later skips it.
begin;

-- New plan tiers (T2): Pro 99 (cap 400), Max 149 with 3 slots, Ultra 249 with 5 slots.
-- slot_limit_for(), daily_cap_for() and companion_locked() read these constants, so nothing else is replaced.
-- Existing grants are kept by `create or replace`. Mirrors src/lib/config.ts.

create or replace function ally_private.slots_max()   returns int language sql immutable set search_path = '' as $$ select 3 $$;
create or replace function ally_private.slots_ultra() returns int language sql immutable set search_path = '' as $$ select 5 $$;
create or replace function ally_private.cap_pro()     returns int language sql immutable set search_path = '' as $$ select 400 $$;
create or replace function ally_private.price_pro()   returns int language sql immutable set search_path = '' as $$ select 99 $$;
create or replace function ally_private.price_max()   returns int language sql immutable set search_path = '' as $$ select 149 $$;
create or replace function ally_private.price_ultra() returns int language sql immutable set search_path = '' as $$ select 249 $$;

insert into supabase_migrations.schema_migrations (version, name) values ('20261115000002', 'new_tiers');

commit;
