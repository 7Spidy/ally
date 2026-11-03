-- profiles_display_name_valid (20261031000001) calls ally_private.valid_display_name,
-- and a check constraint runs with the writer's privileges. The later
-- "revoke all on all functions in schema ally_private from public, anon,
-- authenticated" lines (20261101000001, 20261102000001) stripped the default
-- PUBLIC execute from it, and service_role never had it, so any direct write
-- to public.profiles by service_role or authenticated failed with
-- "permission denied for function valid_display_name". It is a pure
-- immutable predicate, so granting execute is safe. Any future migration that
-- re-runs the blanket revoke must grant it again.
grant execute on function ally_private.valid_display_name(text) to anon, authenticated, service_role;
