-- New plan tiers (T2): cheaper prices, more Ally slots on Max and Ultra, and a
-- higher hidden daily cap on Pro.
--
--   Pro:   99 INR a month (was 299), hidden daily cap 400 (was 300)
--   Max:   149 INR a month (was 499), 3 Ally slots (was 2)
--   Ultra: 249 INR a month (was 799), 5 Ally slots (was 4)
--
-- slot_limit_for(), daily_cap_for() and companion_locked() read these constant
-- functions, so replacing the constants is all that is needed. Nothing else is
-- redefined. No data changes: Max and Ultra users only gain slots, so no
-- companion becomes newly locked.
--
-- The grants on these functions stay as they are. The only grant state on
-- ally_private functions is the schema-wide "revoke all on all functions ...
-- from public, anon, authenticated", and `create or replace` keeps a function's
-- existing privileges. Nothing needs repeating.
--
-- Constants mirror src/lib/config.ts (PLAN_CONFIG, HIDDEN_DAILY_CAPS);
-- tests/unit/sqlConstants.test.ts fails if either side changes alone.

create or replace function ally_private.slots_max()   returns int language sql immutable set search_path = '' as $$ select 3 $$;
create or replace function ally_private.slots_ultra() returns int language sql immutable set search_path = '' as $$ select 5 $$;
create or replace function ally_private.cap_pro()     returns int language sql immutable set search_path = '' as $$ select 400 $$;
create or replace function ally_private.price_pro()   returns int language sql immutable set search_path = '' as $$ select 99 $$;
create or replace function ally_private.price_max()   returns int language sql immutable set search_path = '' as $$ select 149 $$;
create or replace function ally_private.price_ultra() returns int language sql immutable set search_path = '' as $$ select 249 $$;
