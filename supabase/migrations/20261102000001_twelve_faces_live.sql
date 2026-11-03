-- B7: the remaining twelve faces live (F06, F10, F12, F14, F15, F16, M11 to M16) and every face open to
-- everyone. Mirrors src/personas/registry.ts (LIVE_TEMPLATES, brainOf) and src/lib/coreMap.ts. A companion is
-- live when its template is listed and its core.primary equals the face's primary core. Audience is now 'all'
-- for all 32 rows, so the role check in is_live() no longer decides anything but stays for later gating.
--
-- Rollout order (D9): land the code first, then this migration. With only the code, nothing new goes live
-- because the old is_live() still says no. With only this migration, a user could go live with a face
-- personaFor() does not know yet.

create or replace function ally_private.live_faces()
returns table (template_id text, primary_core text, secondary_core text, audience text)
language sql immutable set search_path = '' as $$
  values
    ('F01', 'ROMANTIC', 'MONEY', 'all'),
    ('F02', 'ROMANTIC', 'PSYCH', 'all'),
    ('F03', 'ROMANTIC', 'TRAINER', 'all'),
    ('F04', 'PSYCH', null, 'all'),
    ('F05', 'ROMANTIC', 'FRIEND', 'all'),
    ('F06', 'ROMANTIC', 'TRAINER', 'all'),
    ('F07', 'PSYCH', null, 'all'),
    ('F08', 'TRAINER', null, 'all'),
    ('F09', 'FRIEND', null, 'all'),
    ('F10', 'ROMANTIC', 'TRAINER', 'all'),
    ('F11', 'MONEY', null, 'all'),
    ('F12', 'FRIEND', null, 'all'),
    ('F13', 'MONEY', 'FRIEND', 'all'),
    ('F14', 'ROMANTIC', null, 'all'),
    ('F15', 'ROMANTIC', 'PSYCH', 'all'),
    ('F16', 'ROMANTIC', 'MONEY', 'all'),
    ('M01', 'ROMANTIC', 'MONEY', 'all'),
    ('M02', 'ROMANTIC', 'MONEY', 'all'),
    ('M03', 'ROMANTIC', 'FRIEND', 'all'),
    ('M04', 'ROMANTIC', 'PSYCH', 'all'),
    ('M05', 'ROMANTIC', 'MONEY', 'all'),
    ('M06', 'MONEY', null, 'all'),
    ('M07', 'ROMANTIC', 'FRIEND', 'all'),
    ('M08', 'TRAINER', null, 'all'),
    ('M09', 'TRAINER', 'PSYCH', 'all'),
    ('M10', 'FRIEND', null, 'all'),
    ('M11', 'PSYCH', null, 'all'),
    ('M12', 'ROMANTIC', 'TRAINER', 'all'),
    ('M13', 'PSYCH', null, 'all'),
    ('M14', 'ROMANTIC', null, 'all'),
    ('M15', 'FRIEND', 'TRAINER', 'all'),
    ('M16', 'ROMANTIC', null, 'all')
$$;

revoke all on function ally_private.live_faces() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill. A companion created before the decks were limited to primary-core
-- faces can hold a core that differs from its face's primary core, which makes
-- is_live() false (mock replies). Align each active one to its face's core, the
-- same shape qa_add_companion writes. `ranked` is kept. Parted companions
-- already carry the empty core and are left alone.
-- ---------------------------------------------------------------------------
update public.companions c
set core = jsonb_set(
             jsonb_set(
               jsonb_set(c.core, '{primary}', to_jsonb(f.primary_core)),
               '{secondary}', coalesce(to_jsonb(f.secondary_core), 'null'::jsonb)),
             '{weight}', to_jsonb(case when f.secondary_core is null then 100 else 70 end))
from ally_private.live_faces() f
where f.template_id = c.template_id
  and c.status = 'active'
  and (c.core->>'primary') is distinct from f.primary_core;
